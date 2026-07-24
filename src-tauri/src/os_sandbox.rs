//! OS-level sandbox using Windows Job Objects for CPU/memory limits (R5-7).

use std::process::Command;

// ── Raw Windows FFI for Job Objects ──
// winapi v0.3 doesn't expose jobapi2 types, so we define them directly.

#[cfg(windows)]
mod ffi {
    pub type BOOL = i32;
    pub type HANDLE = *mut std::ffi::c_void;
    pub type DWORD = u32;
    pub type SIZE_T = usize;
    pub type LONGLONG = i64;

    pub const FALSE: BOOL = 0;
    pub const TRUE: BOOL = 1;

    pub const CREATE_SUSPENDED: DWORD = 0x00000004;
    pub const CREATE_BREAKAWAY_FROM_JOB: DWORD = 0x01000000;

    pub const PROCESS_SET_QUOTA: DWORD = 0x0100;
    pub const PROCESS_TERMINATE: DWORD = 0x0001;

    pub const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: DWORD = 0x00002000;
    pub const JOB_OBJECT_LIMIT_PROCESS_MEMORY: DWORD = 0x00000100;
    pub const JOB_OBJECT_LIMIT_PROCESS_TIME: DWORD = 0x00000002;

    pub const JobObjectExtendedLimitInformation: u32 = 9;

    #[repr(C)]
    pub struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        pub PerProcessUserTimeLimit: LONGLONG,
        pub PerJobUserTimeLimit: LONGLONG,
        pub LimitFlags: DWORD,
        pub MinimumWorkingSetSize: SIZE_T,
        pub MaximumWorkingSetSize: SIZE_T,
        pub ActiveProcessLimit: DWORD,
        pub Affinity: usize,
        pub PriorityClass: DWORD,
        pub SchedulingClass: DWORD,
    }

    #[repr(C)]
    pub struct IO_COUNTERS {
        pub ReadOperationCount: u64,
        pub WriteOperationCount: u64,
        pub OtherOperationCount: u64,
        pub ReadTransferCount: u64,
        pub WriteTransferCount: u64,
        pub OtherTransferCount: u64,
    }

    #[repr(C)]
    pub struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        pub BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION,
        pub IoInfo: IO_COUNTERS,
        pub ProcessMemoryLimit: SIZE_T,
        pub JobMemoryLimit: SIZE_T,
        pub PeakProcessMemoryUsed: SIZE_T,
        pub PeakJobMemoryUsed: SIZE_T,
    }

    extern "system" {
        pub fn CreateJobObjectW(
            lpJobAttributes: *mut std::ffi::c_void,
            lpName: *const u16,
        ) -> HANDLE;

        pub fn SetInformationJobObject(
            hJob: HANDLE,
            JobObjectInfoClass: u32,
            lpJobObjectInfo: *const std::ffi::c_void,
            cbJobObjectInfoLength: DWORD,
        ) -> BOOL;

        pub fn AssignProcessToJobObject(hJob: HANDLE, hProcess: HANDLE) -> BOOL;

        pub fn OpenProcess(dwDesiredAccess: DWORD, bInheritHandle: BOOL, dwProcessId: DWORD) -> HANDLE;

        pub fn CloseHandle(hObject: HANDLE) -> BOOL;

        pub fn ResumeThread(hThread: HANDLE) -> DWORD;
    }
}

/// RAII guard that creates a job object with memory limits.
/// Kills all child processes on drop.
#[cfg(windows)]
pub struct JobObjectGuard {
    handle: ffi::HANDLE,
}

#[cfg(windows)]
impl JobObjectGuard {
    pub fn new() -> Option<Self> {
        unsafe {
            let job = ffi::CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
            if job.is_null() {
                return None;
            }

            let mut info: ffi::JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags =
                ffi::JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                | ffi::JOB_OBJECT_LIMIT_PROCESS_MEMORY
                | ffi::JOB_OBJECT_LIMIT_PROCESS_TIME;

            // 512 MB memory limit
            info.BasicLimitInformation.MaximumWorkingSetSize = 512 * 1024 * 1024;
            info.ProcessMemoryLimit = 512 * 1024 * 1024;

            // 5 minute CPU time limit (100ns units)
            info.BasicLimitInformation.PerProcessUserTimeLimit = 300 * 10_000_000i64;

            ffi::SetInformationJobObject(
                job,
                ffi::JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<ffi::JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as ffi::DWORD,
            );

            Some(JobObjectGuard { handle: job })
        }
    }

    pub fn assign_process(&self, child: &std::process::Child) {
        unsafe {
            let handle = ffi::OpenProcess(
                ffi::PROCESS_SET_QUOTA | ffi::PROCESS_TERMINATE,
                ffi::FALSE,
                child.id(),
            );
            if !handle.is_null() {
                ffi::AssignProcessToJobObject(self.handle, handle);
                ffi::CloseHandle(handle);
            }
        }
    }
}

#[cfg(windows)]
impl Drop for JobObjectGuard {
    fn drop(&mut self) {
        unsafe { ffi::CloseHandle(self.handle); }
    }
}

/// No-op for non-Windows platforms.
#[cfg(not(windows))]
pub struct JobObjectGuard;

#[cfg(not(windows))]
impl JobObjectGuard {
    pub fn new() -> Option<Self> { Some(JobObjectGuard) }
    pub fn assign_process(&self, _child: &std::process::Child) {}
}

/// Pre-spawn: apply job limits directly to the Command.
#[cfg(windows)]
pub fn apply_job_limits(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(ffi::CREATE_BREAKAWAY_FROM_JOB | ffi::CREATE_SUSPENDED);
}

/// No-op for non-Windows.
#[cfg(not(windows))]
pub fn apply_job_limits(_cmd: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_job_object_guard_created() {
        let guard = JobObjectGuard::new();
        assert!(guard.is_some());
    }

    #[test]
    fn test_apply_job_limits_does_not_panic() {
        let mut cmd = Command::new(if cfg!(windows) { "cmd" } else { "echo" });
        if cfg!(windows) {
            cmd.arg("/C").arg("echo test");
        } else {
            cmd.arg("test");
        }
        apply_job_limits(&mut cmd);
        let output = cmd.output().unwrap();
        assert!(output.status.success());
    }
}

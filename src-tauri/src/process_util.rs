//! Helpers for spawning subprocesses without flashing a console on Windows.

use std::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Prevent `cmd`, `powershell`, `git`, etc. from opening a visible console window.
pub fn hide_console(_cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

pub fn command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    hide_console(&mut cmd);
    cmd
}

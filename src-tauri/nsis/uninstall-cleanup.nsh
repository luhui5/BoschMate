; Custom uninstall hook: also clean app data stored under product name "YourMate"
; The default Tauri uninstaller only cleans %LOCALAPPDATA%\<bundleId> (i.e. com.yourmate.app),
; but our app stores data under %LOCALAPPDATA%\YourMate (hardcoded product name in main.rs).
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RmDir /r "$LOCALAPPDATA\YourMate"
  ${EndIf}
!macroend

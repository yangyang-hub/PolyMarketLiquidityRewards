!macro customInstall
  ${if} ${FileExists} "$INSTDIR\resources\logo.ico"
    !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
      ${if} ${FileExists} "$newStartMenuLink"
        CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\logo.ico" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
      ${endif}
    !endif

    !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
      ${if} ${FileExists} "$newDesktopLink"
        CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\logo.ico" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      ${endif}
    !endif

    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endif}
!macroend

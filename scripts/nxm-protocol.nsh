; Registers nxm:// (Nexus Mods' "Mod Manager Download" links) for this user when the
; launcher is installed, and removes it on uninstall if it still points here. The app
; itself changes no system setting (electron/main.cjs); package.json's nsis.include
; adds this file to the Windows installer.

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\nxm" "" "URL:Nexus Mods"
  WriteRegStr SHCTX "Software\Classes\nxm" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\nxm\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\nxm\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  ReadRegStr $0 SHCTX "Software\Classes\nxm\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"' 0 +2
    DeleteRegKey SHCTX "Software\Classes\nxm"
!macroend

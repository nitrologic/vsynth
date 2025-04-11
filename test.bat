@echo off
set "folder=%~dp0"
set "folder=%folder:~0,-1%"
set "url=file:///%folder:\=/%/vsynth-demo.html"
set "flags=--disable-web-security --allow-file-access-from-files --unsafely-treat-insecure-origin-as-secure"
start chrome %flags% %url%

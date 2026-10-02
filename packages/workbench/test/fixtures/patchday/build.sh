#!/bin/sh
# Rebuilds the two Windows (PE) fixtures with LLVM 18 (clang + lld-link + llvm-rc)
# and stores each as gzipped base64 text. The tests don't run this; the committed
# .gz.b64 files are what they read (test/helpers/pe-builder.ts decodes them). They
# exist so the PE reader is checked against files a real toolchain produced, not
# only against ones the test helper builds.
set -e
cd "$(dirname "$0")"
clang --target=x86_64-pc-windows-msvc -ffreestanding -fno-stack-protector -O1 -c plugin.c -o plugin.obj
lld-link /dll /noentry /nodefaultlib /machine:x64 plugin.obj /out:real-plugin.dll
clang --target=x86_64-pc-windows-msvc -ffreestanding -fno-stack-protector -O1 -c main.c -o main.obj
llvm-rc /FO game.res game.rc
lld-link /subsystem:console /entry:main /nodefaultlib /machine:x64 main.obj game.res /out:real-game-1.6.1170.exe
gzip -9n -c real-plugin.dll | base64 | fold -w 76 > real-plugin.dll.gz.b64
gzip -9n -c real-game-1.6.1170.exe | base64 | fold -w 76 > real-game-1.6.1170.exe.gz.b64
rm -f plugin.obj main.obj game.res real-plugin.lib real-plugin.dll real-game-1.6.1170.exe

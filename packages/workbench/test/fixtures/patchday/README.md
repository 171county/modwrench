# Patch Day fixtures

Two tiny Windows (PE) files built by a real toolchain, so the PE reader is checked
against something other than the test helper that builds files in memory.

| File | What it is |
|---|---|
| `real-plugin.dll.b64` | An x64 DLL exporting `SKSEPlugin_Version` (a data export, laid out as SKSE's `SKSEPluginVersionData`) and `SKSEPlugin_Load`. Declares: name `RealToolchainPlugin`, Address Library + post-1.6.629 structs (`versionIndependence` = 5), Address Library format 5 (`versionIndependenceEx` = 2), needs SKSE 2.2.6. |
| `real-game-1.6.1170.exe.b64` | An x64 executable whose only job is carrying a `VS_VERSIONINFO` resource: file version 1.6.1170.0. |

Both are stored as base64 text, so the repository holds no executable files and
any review tool can show them. `test/helpers/pe-builder.ts` decodes them into a
private temp folder when the tests start; to look at one by hand, run
`base64 -d real-plugin.dll.b64 > real-plugin.dll`.

`plugin.c`, `main.c` and `game.rc` are the sources; `sh build.sh` rebuilds both with
clang, lld-link and llvm-rc (LLVM 18) and rewrites the `.b64` files. Neither file does
anything when run — they have no real code and are never executed by the tests, which
only read their bytes.

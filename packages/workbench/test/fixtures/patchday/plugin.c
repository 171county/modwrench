typedef unsigned int u32;
typedef struct {
  u32 dataVersion; u32 pluginVersion; char name[256]; char author[256]; char supportEmail[252];
  u32 versionIndependenceEx; u32 versionIndependence; u32 compatibleVersions[16]; u32 seVersionRequired;
} SKSEPluginVersionData;
__declspec(dllexport) const SKSEPluginVersionData SKSEPlugin_Version = {
  1, 0x01020300, "RealToolchainPlugin", "fixture", "", 2 /*V5*/ , 1 | 4 /*AL + Structs629*/, {0}, 0x02020060 };
__declspec(dllexport) int SKSEPlugin_Load(void *skse) { (void)skse; return 1; }

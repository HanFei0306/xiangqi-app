#!/usr/bin/env python3
"""Build the final Xiangqi Trainer APK from the latest Vite dist.

Key invariants learned from prior iterations:
  * Android WebView loads file:///android_asset/public/index.html where the
    origin is "null", so ES modules are blocked by CORS. The index.html MUST
    use a classic (non-module) <script> with a RELATIVE path, placed after
    #root in the DOM.
  * resources.arsc and classes.dex MUST be STORED (uncompressed) and 4-byte
    aligned, otherwise Android 11+ (targetSdk 30+) refuses to install with
    INSTALL_PARSE_FAILED_RESOURCES_ARSC_COMPRESSED.
  * The binary AndroidManifest.xml is RECOMPILED from the text
    AndroidManifest.xml with aapt2 on every build. Previously a stale prebuilt
    binary manifest (versionCode=1 / versionName=1.0) was copied verbatim from
    `stage-responsive`, so users could never overwrite-install an older APK.
    The text manifest is now the single source of truth for the app version.
  * The JS/CSS file names are discovered from dist/assets so a fresh Vite
    build with new content hashes cannot break the packaging step.
"""
import os
import re
import shutil
import subprocess
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))                    # tools/manual-apk
TOOLS = os.path.dirname(ROOT)                                        # tools
WORKSPACE = os.path.dirname(TOOLS)                                   # project root
DIST = os.path.join(WORKSPACE, 'xiangqi-trainer', 'dist')
SRC_STAGE = os.path.join(ROOT, 'stage-responsive')   # known-good native parts
STAGE = os.path.join(ROOT, 'stage-final')
BIN = os.path.join(ROOT, 'bin')
SDK = os.path.join(TOOLS, 'android-sdk', 'build-tools', '34.0.0')
ANDROID_JAR = os.path.join(TOOLS, 'android-sdk', 'platforms', 'android-34', 'android.jar')
NDK_ROOT = os.path.join(TOOLS, 'android-sdk', 'ndk', '27.2.12479018')
NDK_BUILD = os.path.join(NDK_ROOT, 'ndk-build')
JAVA_HOME = os.path.join(TOOLS, 'jdk17', 'jdk-17.0.21.0.2+1', 'Contents', 'Home')
JAVAC = os.path.join(JAVA_HOME, 'bin', 'javac')
D8 = os.path.join(SDK, 'd8')
SRC_JAVA = os.path.join(ROOT, 'src', 'com', 'xiangqi', 'trainer', 'MainActivity.java')
GEN_JAVA = os.path.join(ROOT, 'gen', 'com', 'xiangqi', 'trainer', 'R.java')
OBJ_DIR = os.path.join(ROOT, 'obj')
CLASSES_DIR = os.path.join(ROOT, 'classes')


def find_web_assets():
    """Returns (js_name, css_name) from the current Vite dist/assets folder."""
    assets_dir = os.path.join(DIST, 'assets')
    if not os.path.isdir(assets_dir):
        raise RuntimeError('dist/assets not found -- run `npx vite build` first')
    js = sorted(name for name in os.listdir(assets_dir) if name.endswith('.js'))
    css = sorted(name for name in os.listdir(assets_dir) if name.endswith('.css'))
    if len(js) != 1 or len(css) != 1:
        raise RuntimeError('expected exactly one built JS and one built CSS: %r / %r' % (js, css))
    return js[0], css[0]


def index_html(js_name, css_name):
    """Classic-script HTML for the file:// WebView origin."""
    return '''<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%236E3218'/%3E%3Ccircle cx='32' cy='34' r='20' fill='%23CEB280'/%3E%3Ccircle cx='32' cy='32' r='20' fill='%23C9A23C'/%3E%3Ccircle cx='32' cy='32' r='18' fill='%23F4E4C2'/%3E%3Ccircle cx='32' cy='32' r='15' fill='none' stroke='%2396701E' stroke-width='1.4'/%3E%3Ctext x='32' y='40' font-size='21' text-anchor='middle' fill='%23B0281E'%3E%E5%B8%A5%3C/text%3E%3C/svg%3E" />
    <title>象棋训练 · Xiangqi Trainer</title>
    <link rel="stylesheet" href="assets/{css}">
  </head>
  <body>
    <div id="root"></div>
    <!-- Classic (non-module) script: file:// origin is "null" in Android WebView,
         so ES modules would be blocked by CORS. Bundle is self-contained (no
         import/export), and must run after #root exists. -->
    <script src="assets/{js}"></script>
  </body>
</html>
'''.format(css=css_name, js=js_name)


def build_binary_manifest():
    """Compiles the text AndroidManifest.xml into a binary manifest via aapt2.

    `aapt2 link` writes a binary AndroidManifest.xml inside a temporary APK;
    that entry is extracted and reused as the native part of the final APK.
    """
    tmp = os.path.join(BIN, 'manifest-build')
    if os.path.exists(tmp):
        shutil.rmtree(tmp)
    os.makedirs(tmp, exist_ok=True)
    res_zip = os.path.join(tmp, 'res.zip')
    out_apk = os.path.join(tmp, 'manifest.apk')
    subprocess.run([
        os.path.join(SDK, 'aapt2'), 'compile', '-o', res_zip,
        os.path.join(ROOT, 'res', 'drawable', 'ic_launcher.png'),
    ], check=True)
    subprocess.run([
        os.path.join(SDK, 'aapt2'), 'link', '-o', out_apk,
        '-I', ANDROID_JAR,
        '--manifest', os.path.join(ROOT, 'AndroidManifest.xml'),
        '--min-sdk-version', '22', '--target-sdk-version', '34',
        res_zip,
    ], check=True)
    with zipfile.ZipFile(out_apk) as zf:
        return zf.read('AndroidManifest.xml')


def build_native_dex():
    """Compile MainActivity.java (+ generated R.java) into classes.dex.

    Since v2026.11.19.2 the WebView rendering settings live in source and MUST
    be recompiled on every build — a stale prebuilt dex silently kept the old
    overview-zoom behaviour that blurred the board on real devices.
    """
    if os.path.exists(OBJ_DIR):
        shutil.rmtree(OBJ_DIR)
    os.makedirs(OBJ_DIR, exist_ok=True)
    env = os.environ.copy()
    env['JAVA_HOME'] = JAVA_HOME
    env['PATH'] = os.path.join(JAVA_HOME, 'bin') + os.pathsep + env.get('PATH', '')
    subprocess.run([
        JAVAC, '-source', '8', '-target', '8', '-encoding', 'UTF-8',
        '-cp', ANDROID_JAR, '-d', OBJ_DIR, SRC_JAVA, GEN_JAVA,
    ], check=True, env=env)
    class_files = []
    for root, _, files in os.walk(OBJ_DIR):
        for name in files:
            if name.endswith('.class'):
                class_files.append(os.path.join(root, name))
    if not class_files:
        raise RuntimeError('javac produced no .class files')
    if os.path.exists(CLASSES_DIR):
        shutil.rmtree(CLASSES_DIR)
    os.makedirs(CLASSES_DIR, exist_ok=True)
    subprocess.run([D8, '--lib', ANDROID_JAR, '--output', CLASSES_DIR] + class_files,
                   check=True, env=env)
    dex = os.path.join(CLASSES_DIR, 'classes.dex')
    if not os.path.isfile(dex):
        raise RuntimeError('d8 did not produce classes.dex')
    print('dex     compiled from source', os.path.getsize(dex), 'bytes')
    return dex


def build_native_libs():
    """Build the Pikafish JNI SKELETON .so for both supported ABIs.

    No Pikafish source and no NNUE weights are compiled here. This only proves
    the Android native library + JS bridge path works, so a licensed engine
    can be dropped in later without changing the host app again.
    """
    if not os.path.isfile(NDK_BUILD):
        print('native lib (SKIP): NDK not found at', NDK_ROOT)
        return []
    env = os.environ.copy()
    env['JAVA_HOME'] = JAVA_HOME
    libs_out = os.path.join(BIN, 'jniLibs')
    obj_out = os.path.join(BIN, 'jniObj')
    subprocess.run([
        NDK_BUILD,
        'NDK_PROJECT_PATH=' + ROOT,
        'APP_BUILD_SCRIPT=' + os.path.join(ROOT, 'jni', 'Android.mk'),
        'NDK_LIBS_OUT=' + libs_out,
        'NDK_OUT=' + obj_out,
    ], check=True, env=env)
    rels = []
    for abi in sorted(os.listdir(libs_out)):
        libdir = os.path.join(libs_out, abi)
        if not os.path.isdir(libdir):
            continue
        for name in sorted(os.listdir(libdir)):
            if not name.endswith('.so'):
                continue
            rel = os.path.join('lib', abi, name)
            dst = os.path.join(STAGE, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(os.path.join(libdir, name), dst)
            print('native lib', rel, os.path.getsize(dst))
            rels.append(rel)
    if not rels:
        raise RuntimeError('ndk-build produced no .so files')
    return rels


def main():
    # 1. Fresh stage dir.
    if os.path.exists(STAGE):
        shutil.rmtree(STAGE)
    os.makedirs(os.path.join(STAGE, 'assets', 'public', 'assets'))
    os.makedirs(os.path.join(STAGE, 'res', 'drawable'))

    # 2. Native parts. The manifest is compiled from the versioned text source;
    #    overwrite the cached copy in stage-responsive too, so no other script
    #    can accidentally reintroduce versionCode=1.
    manifest_bytes = build_binary_manifest()
    with open(os.path.join(SRC_STAGE, 'AndroidManifest.xml'), 'wb') as f:
        f.write(manifest_bytes)
    print('manifest', 'aapt2 -> versionCode=59 / versionName=2026.11.25.2', len(manifest_bytes))
    # Compile the native dex from source so WebView rendering fixes actually
    # ship; keep stage-responsive's copy in sync to avoid any stale reintroduction.
    fresh_dex = build_native_dex()
    shutil.copy2(fresh_dex, os.path.join(SRC_STAGE, 'classes.dex'))
    for rel in ['classes.dex', 'resources.arsc', 'res/drawable/ic_launcher.png']:
        src = os.path.join(SRC_STAGE, rel)
        dst = os.path.join(STAGE, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        print('native  ', rel, os.path.getsize(dst))
    native_libs = build_native_libs()
    with open(os.path.join(STAGE, 'AndroidManifest.xml'), 'wb') as f:
        f.write(manifest_bytes)

    # 3. Web assets from fresh dist (names discovered, never hardcoded).
    js_name, css_name = find_web_assets()
    with open(os.path.join(STAGE, 'assets', 'public', 'index.html'), 'w', encoding='utf-8') as f:
        f.write(index_html(js_name, css_name))
    shutil.copy2(os.path.join(DIST, 'assets', js_name),
                 os.path.join(STAGE, 'assets', 'public', 'assets', js_name))
    shutil.copy2(os.path.join(DIST, 'assets', css_name),
                 os.path.join(STAGE, 'assets', 'public', 'assets', css_name))
    print('web     index.html +', js_name, '+', css_name)

    # 3b. Background music (v2026.11.19.3): public/music/ is copied verbatim by
    #     Vite into dist/music/. The WebView loads index.html from
    #     file:///android_asset/public/, so a relative <audio src="music/x">
    #     resolves to android_asset/public/music/x. Copy it there.
    music_src = os.path.join(DIST, 'music')
    if os.path.isdir(music_src):
        music_dst = os.path.join(STAGE, 'assets', 'public', 'music')
        if os.path.exists(music_dst):
            shutil.rmtree(music_dst)
        shutil.copytree(music_src, music_dst)
        mcount = sum(len(f) for _, _, f in os.walk(music_dst))
        print('music   ', mcount, 'files ->', music_dst)
    else:
        print('music    (no dist/music; skipping)')

    # 3a. Native voice cues for the practice page (same clips as normal game).
    voice_src = os.path.join(ROOT, 'voice-assets')
    if os.path.isdir(voice_src):
        voice_dst = os.path.join(STAGE, 'assets', 'voice')
        os.makedirs(voice_dst, exist_ok=True)
        for name in ('capture.m4a', 'check.m4a', 'mate.m4a', 'land.wav'):
            shutil.copy2(os.path.join(voice_src, name), os.path.join(voice_dst, name))
        print('voice    4 native cues (incl. land.wav) -> assets/voice')

    # 3b. Optional non-commercial Pikafish network. Never included in self builds.
    if os.environ.get('XQ_NC') == '1':
        net_src = os.path.join(TOOLS, 'pikafish-net', 'pikafish.nnue')
        if not os.path.isfile(net_src):
            raise RuntimeError('XQ_NC=1 but NNUE network is missing: ' + net_src)
        net_dst = os.path.join(STAGE, 'assets', 'public', 'engine', 'pikafish.nnue')
        os.makedirs(os.path.dirname(net_dst), exist_ok=True)
        shutil.copy2(net_src, net_dst)
        lic_dir = os.path.join(STAGE, 'assets', 'public', 'licenses')
        os.makedirs(lic_dir, exist_ok=True)
        for name in ('NNUE_LICENSE.txt', 'PIKAFISH_GPLv3.txt'):
            shutil.copy2(os.path.join(TOOLS, 'pikafish-net', name),
                         os.path.join(lic_dir, name))
        print('nnue     NON-COMMERCIAL pikafish.nnue', os.path.getsize(net_dst))
    else:
        print('nnue     (self build; no third-party weights)')

    # 4. Package: STORED for arsc/dex, DEFLATED for the rest.
    os.makedirs(BIN, exist_ok=True)
    unsigned = os.path.join(BIN, 'unsigned-final.apk')
    # Entry order matters: put STORED binary files first so zipalign can pad
    # them cleanly; assets go after.
    stored = ['classes.dex', 'resources.arsc'] + native_libs + [
        'assets/voice/capture.m4a', 'assets/voice/check.m4a', 'assets/voice/mate.m4a'
    ]
    all_files = []
    for root, _, files in os.walk(STAGE):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, STAGE)
            all_files.append(rel)
    def order_key(rel):
        if rel in stored:
            return (0, stored.index(rel))
        return (1, rel)
    all_files.sort(key=order_key)

    with zipfile.ZipFile(unsigned, 'w', allowZip64=True) as z:
        for rel in all_files:
            full = os.path.join(STAGE, rel)
            if rel in stored:
                z.write(full, rel, compress_type=zipfile.ZIP_STORED)
            else:
                z.write(full, rel, compress_type=zipfile.ZIP_DEFLATED)
    print('packed  ', unsigned, os.path.getsize(unsigned))

    # 5. zipalign 4 bytes (in place via temp).
    aligned = os.path.join(BIN, 'aligned-final.apk')
    subprocess.run([os.path.join(SDK, 'zipalign'), '-f', '4', unsigned, aligned], check=True)
    print('aligned ', aligned, os.path.getsize(aligned))

    # 6. Sign with debug keystore (v1+v2+v3).
    # APK 文件名跟版本号走：xiangqi-vYYYY.MM.DD.N.apk
    with open(os.path.join(ROOT, 'AndroidManifest.xml'), 'r', encoding='utf-8') as mf:
        version_name = re.search(r'android:versionName="([^"]+)"', mf.read()).group(1)
    signed = os.path.join(WORKSPACE, 'xiangqi-trainer', 'xiangqi-v%s.apk' % version_name)
    env = os.environ.copy()
    env['JAVA_HOME'] = os.path.join(TOOLS,
                                    'jdk17', 'jdk-17.0.21.0.2+1', 'Contents', 'Home')
    env['PATH'] = env['JAVA_HOME'] + '/bin:' + env['PATH']
    subprocess.run([
        os.path.join(SDK, 'apksigner'), 'sign',
        '--ks', os.path.join(ROOT, 'keystore', 'debug.jks'),
        '--ks-key-alias', 'androiddebugkey',
        '--ks-pass', 'pass:android',
        '--key-pass', 'pass:android',
        '--v1-signing-enabled', 'true',
        '--v2-signing-enabled', 'true',
        '--v3-signing-enabled', 'true',
        '--out', signed, aligned,
    ], check=True, env=env)
    print('signed  ', signed, os.path.getsize(signed))

    print('\nDONE:', signed)


if __name__ == '__main__':
    main()

# Markflow Mobile

Android reader for local and remote Markdown documents.

## Run Locally

```bash
pnpm install
pnpm start
```

Then press `a` in the Expo CLI to open it on an Android emulator, or scan the QR code with Expo Go.

## Build an Installable APK

```bash
pnpm build:apk
```

The `preview` profile in `eas.json` sets `android.buildType` to `apk`, so the result can be installed directly on an Android device.
The command uses EAS Build, so you will need to be logged in to Expo.

For a local Android build, use the generated Gradle project under `android/` after running Expo prebuild:

```bash
pnpm exec expo prebuild -p android --no-install
cd android
./gradlew assembleRelease --no-daemon
```

The APK is written to `android/app/build/outputs/apk/release/app-release.apk`.

## Reader Flows

- `Local` opens the Android document picker and reads `.md`, `.markdown`, or text files from the device.
- `Load` accepts raw Markdown URLs and common GitHub file links such as `https://github.com/user/repo/blob/main/README.md`.
- `GitHub` validates and stores a token on the device so private repository Markdown can load through GitHub's contents API. Use a fine-grained personal access token with `Contents: read` access for the repositories you want to read.
- Markdown links to other `.md` files open inside Markflow when possible; other links open through Android.

## App Icon

The launcher icon source files live in `assets/markflow-icon.svg` and `assets/markflow-adaptive-foreground.svg`.
The generated PNGs used by Expo are `assets/icon.png` and `assets/adaptive-icon.png`.

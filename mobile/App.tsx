import { StatusBar, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { appStyles as styles } from "./src/appStyles";
import { MarkdownReader, openExternalUrl } from "./src/components/MarkdownReader";
import { MobileControls, MobileTopbar } from "./src/components/MobileChrome";
import { useGitHubCredentials } from "./src/hooks/useGitHubCredentials";
import { useMobileDocumentSession } from "./src/hooks/useMobileDocumentSession";
import { colors } from "./src/theme";
import { isLikelyMarkdownUrl, resolveAgainstDocumentOrigin } from "./src/utils/github";

export default function App() {
  return (
    <SafeAreaProvider>
      <MarkflowMobileApp />
    </SafeAreaProvider>
  );
}

function MarkflowMobileApp() {
  const github = useGitHubCredentials();
  const documents = useMobileDocumentSession({
    credentialsReady: github.ready,
    getGitHubToken: github.getToken
  });
  const isLoading = documents.isLoading || github.status.kind === "loading";

  function handleMarkdownLinkPress(url: string): void {
    const resolvedUrl = resolveAgainstDocumentOrigin(url, documents.document?.origin);

    if (isLikelyMarkdownUrl(resolvedUrl)) {
      void documents.openIncomingUrl(resolvedUrl);
      return;
    }

    openExternalUrl(resolvedUrl);
  }

  return (
    <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.topbarBg} />
      <View style={styles.shell}>
        <MobileTopbar
          documentStatus={documents.documentStatus}
          onModeChange={documents.setReaderMode}
          readerMode={documents.readerMode}
        />
        <MobileControls documents={documents} github={github} isLoading={isLoading} />
        <View style={styles.readerStage}>
          <MarkdownReader
            document={documents.document}
            mode={documents.readerMode}
            onMarkdownLinkPress={handleMarkdownLinkPress}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

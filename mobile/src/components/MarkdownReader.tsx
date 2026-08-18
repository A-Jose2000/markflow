import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import Markdown from "react-native-markdown-display";
import type { MarkdownDocument, ReaderMode } from "../types";
import { colors, markdownStyles, monoFont } from "../theme";

interface MarkdownReaderProps {
  document: MarkdownDocument | undefined;
  mode: ReaderMode;
  onMarkdownLinkPress: (url: string) => void;
}

export function MarkdownReader({ document, mode, onMarkdownLinkPress }: MarkdownReaderProps) {
  if (!document) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No document loaded</Text>
        <Text style={styles.emptyCopy}>Choose a local file or load a Markdown URL.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {mode === "source" ? (
        <Text selectable style={styles.rawMarkdown}>
          {document.markdown}
        </Text>
      ) : (
        <Markdown
          onLinkPress={(url) => {
            onMarkdownLinkPress(url);

            return false;
          }}
          style={markdownStyles}
        >
          {document.markdown}
        </Markdown>
      )}
    </ScrollView>
  );
}

export function openExternalUrl(url: string): void {
  Linking.openURL(url).catch(() => {
    // The app keeps reading even if Android cannot route a non-Markdown link.
  });
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingBottom: 44,
    paddingHorizontal: 20,
    paddingTop: 18
  },
  emptyCopy: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center"
  },
  emptyState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 34
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 28,
    marginBottom: 8,
    textAlign: "center"
  },
  rawMarkdown: {
    color: colors.textSoft,
    fontFamily: monoFont,
    fontSize: 14,
    lineHeight: 23
  }
});

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Linking,
  Pressable,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { MarkdownReader, openExternalUrl } from "./src/components/MarkdownReader";
import { clearGitHubToken, loadGitHubToken, saveGitHubToken } from "./src/storage/githubAuth";
import { clearDocumentSnapshots, loadLastDocument, loadRecentDocuments, saveDocumentSnapshot } from "./src/storage/recentDocuments";
import { colors } from "./src/theme";
import type { LoadStatus, MarkdownDocument, ReaderMode } from "./src/types";
import { validateGitHubToken } from "./src/utils/githubAuth";
import { isLikelyMarkdownUrl, resolveAgainstDocumentOrigin } from "./src/utils/github";
import { loadMarkdownFromIncomingUrl, loadRemoteMarkdown, pickMarkdownDocument } from "./src/utils/documents";

export default function App() {
  return (
    <SafeAreaProvider>
      <MarkflowMobileApp />
    </SafeAreaProvider>
  );
}

function MarkflowMobileApp() {
  const [document, setDocument] = useState<MarkdownDocument | undefined>();
  const [recentDocuments, setRecentDocuments] = useState<MarkdownDocument[]>([]);
  const [readerMode, setReaderMode] = useState<ReaderMode>("rendered");
  const [status, setStatus] = useState<LoadStatus>({ kind: "idle" });
  const [urlInput, setUrlInput] = useState("");
  const [githubToken, setGitHubToken] = useState<string | undefined>();
  const [githubTokenInput, setGitHubTokenInput] = useState("");
  const [isGitHubPanelOpen, setIsGitHubPanelOpen] = useState(false);
  const githubTokenRef = useRef<string | undefined>(undefined);
  const isLoading = status.kind === "loading";
  const hasGitHubToken = Boolean(githubToken);

  const documentStatus = useMemo(() => formatDocumentStatus(document), [document]);

  useEffect(() => {
    githubTokenRef.current = githubToken;
  }, [githubToken]);

  const commitDocument = useCallback(async (nextDocument: MarkdownDocument): Promise<void> => {
    setDocument(nextDocument);
    setReaderMode("rendered");
    setStatus({ kind: "idle" });

    if (nextDocument.source === "remote") {
      setUrlInput(nextDocument.origin);
    }

    try {
      const nextRecentDocuments = await saveDocumentSnapshot(nextDocument);
      setRecentDocuments(nextRecentDocuments);
    } catch {
      // Storage is a convenience. Opening Markdown should still succeed if it fails.
    }
  }, []);

  const openIncomingUrl = useCallback(
    async (url: string, tokenOverride?: string): Promise<void> => {
      setStatus({ kind: "loading", message: "Opening Markdown..." });

      try {
        const nextDocument = await loadMarkdownFromIncomingUrl(url, {
          githubToken: tokenOverride ?? githubTokenRef.current
        });
        await commitDocument(nextDocument);
      } catch (error) {
        setStatus({ kind: "error", message: messageFromError(error) });
      }
    },
    [commitDocument]
  );

  useEffect(() => {
    let isMounted = true;

    async function restorePreviousSession(): Promise<void> {
      try {
        const [lastDocument, storedRecentDocuments, initialUrl, storedGitHubToken] = await Promise.all([
          loadLastDocument(),
          loadRecentDocuments(),
          Linking.getInitialURL(),
          loadGitHubToken()
        ]);

        if (!isMounted) {
          return;
        }

        setRecentDocuments(storedRecentDocuments);
        setGitHubToken(storedGitHubToken);
        githubTokenRef.current = storedGitHubToken;

        if (lastDocument) {
          setDocument(lastDocument);
          setUrlInput(lastDocument.source === "remote" ? lastDocument.origin : "");
        }

        if (initialUrl) {
          await openIncomingUrl(initialUrl, storedGitHubToken);
        }
      } catch {
        if (isMounted) {
          setStatus({ kind: "idle" });
        }
      }
    }

    restorePreviousSession();

    const subscription = Linking.addEventListener("url", (event) => {
      void openIncomingUrl(event.url);
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [openIncomingUrl]);

  async function handlePickLocalDocument(): Promise<void> {
    setStatus({ kind: "loading", message: "Opening local document..." });

    try {
      const pickedDocument = await pickMarkdownDocument();

      if (!pickedDocument) {
        setStatus({ kind: "idle" });
        return;
      }

      await commitDocument(pickedDocument);
    } catch (error) {
      setStatus({ kind: "error", message: messageFromError(error) });
    }
  }

  async function handleLoadRemoteDocument(url = urlInput): Promise<void> {
    Keyboard.dismiss();
    setStatus({ kind: "loading", message: "Loading Markdown link..." });

    try {
      const nextDocument = await loadRemoteMarkdown(url, {
        githubToken: githubTokenRef.current
      });
      await commitDocument(nextDocument);
    } catch (error) {
      setStatus({ kind: "error", message: messageFromError(error) });
    }
  }

  async function handleRefreshDocument(): Promise<void> {
    if (!document || document.source !== "remote") {
      return;
    }

    await handleLoadRemoteDocument(document.origin);
  }

  async function handleShareDocument(): Promise<void> {
    if (!document) {
      return;
    }

    const message = document.source === "remote" ? document.origin : document.title;

    await Share.share({
      message,
      title: document.title
    });
  }

  async function handleClearRecents(): Promise<void> {
    await clearDocumentSnapshots();
    setRecentDocuments([]);
    setDocument(undefined);
    setStatus({ kind: "idle" });
    setUrlInput("");
  }

  async function handleSaveGitHubToken(): Promise<void> {
    const trimmedToken = githubTokenInput.trim();

    if (!trimmedToken) {
      setStatus({ kind: "error", message: "Paste a GitHub token first." });
      return;
    }

    setStatus({ kind: "loading", message: "Validating GitHub token..." });

    try {
      const validation = await validateGitHubToken(trimmedToken);
      await saveGitHubToken(trimmedToken);
      githubTokenRef.current = trimmedToken;
      setGitHubToken(trimmedToken);
      setGitHubTokenInput("");
      setIsGitHubPanelOpen(false);
      setStatus({ kind: "success", message: `GitHub token saved for @${validation.login}.` });
    } catch (error) {
      setStatus({ kind: "error", message: messageFromError(error) });
    }
  }

  async function handleClearGitHubToken(): Promise<void> {
    setStatus({ kind: "loading", message: "Clearing GitHub token..." });

    try {
      await clearGitHubToken();
      githubTokenRef.current = undefined;
      setGitHubToken(undefined);
      setGitHubTokenInput("");
      setStatus({ kind: "success", message: "GitHub token cleared." });
    } catch (error) {
      setStatus({ kind: "error", message: messageFromError(error) });
    }
  }

  function handleMarkdownLinkPress(url: string): void {
    const resolvedUrl = resolveAgainstDocumentOrigin(url, document?.origin);

    if (isLikelyMarkdownUrl(resolvedUrl)) {
      void openIncomingUrl(resolvedUrl);
      return;
    }

    openExternalUrl(resolvedUrl);
  }

  return (
    <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.topbarBg} />
      <View style={styles.shell}>
        <View style={styles.topbar}>
          <View style={styles.titleBlock}>
            <Text numberOfLines={1} style={styles.appTitle}>
              Markflow
            </Text>
            <Text numberOfLines={1} style={styles.documentStatus}>
              {documentStatus}
            </Text>
          </View>

          <View style={styles.modeSwitcher} accessibilityRole="tablist">
            <ModeButton active={readerMode === "rendered"} label="Reader" onPress={() => setReaderMode("rendered")} />
            <ModeButton active={readerMode === "source"} label="Source" onPress={() => setReaderMode("source")} />
          </View>
        </View>

        <View style={styles.controls}>
          <View style={styles.primaryActions}>
            <ActionButton disabled={isLoading} label="Local" onPress={() => void handlePickLocalDocument()} />
            <ActionButton disabled={isLoading || !document || document.source !== "remote"} label="Refresh" onPress={() => void handleRefreshDocument()} />
            <ActionButton disabled={!document} label="Share" onPress={() => void handleShareDocument()} />
            <ActionButton
              disabled={isLoading}
              label={hasGitHubToken ? "GitHub On" : "GitHub"}
              onPress={() => setIsGitHubPanelOpen((isOpen) => !isOpen)}
            />
          </View>

          <View style={styles.urlRow}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
              keyboardType="url"
              onChangeText={setUrlInput}
              onSubmitEditing={() => void handleLoadRemoteDocument()}
              placeholder="https://github.com/user/repo/blob/main/README.md"
              placeholderTextColor={colors.textMuted}
              returnKeyType="go"
              selectionColor={colors.accent}
              style={styles.urlInput}
              value={urlInput}
            />
            <ActionButton disabled={isLoading} label="Load" onPress={() => void handleLoadRemoteDocument()} variant="accent" />
          </View>

          {isGitHubPanelOpen ? (
            <View style={styles.githubPanel}>
              <View style={styles.githubPanelHeader}>
                <Text style={styles.githubPanelTitle}>GitHub access</Text>
                <Text style={styles.githubPanelHint}>Fine-grained PAT, Contents: read</Text>
              </View>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
                onChangeText={setGitHubTokenInput}
                placeholder={hasGitHubToken ? "Token saved" : "github_pat_..."}
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
                secureTextEntry
                selectionColor={colors.accent}
                style={styles.githubTokenInput}
                value={githubTokenInput}
              />
              <View style={styles.githubTokenActions}>
                <ActionButton
                  disabled={isLoading || githubTokenInput.trim().length === 0}
                  label="Save"
                  onPress={() => void handleSaveGitHubToken()}
                  variant="accent"
                />
                <ActionButton disabled={isLoading || !hasGitHubToken} label="Clear" onPress={() => void handleClearGitHubToken()} />
              </View>
            </View>
          ) : null}

          {recentDocuments.length > 0 ? (
            <View style={styles.recentRow}>
              {recentDocuments.slice(0, 3).map((recentDocument) => (
                <Pressable
                  accessibilityRole="button"
                  key={recentDocument.id}
                  onPress={() => void commitDocument(recentDocument)}
                  style={styles.recentChip}
                >
                  <Text numberOfLines={1} style={styles.recentChipText}>
                    {recentDocument.title}
                  </Text>
                </Pressable>
              ))}
              <Pressable accessibilityRole="button" onPress={() => void handleClearRecents()} style={styles.clearChip}>
                <Text style={styles.clearChipText}>Clear</Text>
              </Pressable>
            </View>
          ) : null}

          {status.kind !== "idle" ? (
            <View
              style={[
                styles.statusBanner,
                status.kind === "error" && styles.statusBannerError,
                status.kind === "success" && styles.statusBannerSuccess
              ]}
            >
              {status.kind === "loading" ? <ActivityIndicator color={colors.accent} size="small" /> : null}
              <Text
                style={[
                  styles.statusText,
                  status.kind === "error" && styles.statusTextError,
                  status.kind === "success" && styles.statusTextSuccess
                ]}
              >
                {status.message}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.readerStage}>
          <MarkdownReader document={document} mode={readerMode} onMarkdownLinkPress={handleMarkdownLinkPress} />
        </View>
      </View>
    </SafeAreaView>
  );
}

interface ActionButtonProps {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  variant?: "default" | "accent";
}

function ActionButton({ disabled = false, label, onPress, variant = "default" }: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        variant === "accent" && styles.actionButtonAccent,
        pressed && !disabled && styles.actionButtonPressed,
        disabled && styles.actionButtonDisabled
      ]}
    >
      <Text style={[styles.actionButtonText, variant === "accent" && styles.actionButtonTextAccent]}>{label}</Text>
    </Pressable>
  );
}

interface ModeButtonProps {
  active: boolean;
  label: string;
  onPress: () => void;
}

function ModeButton({ active, label, onPress }: ModeButtonProps) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.modeButton, active && styles.modeButtonActive]}
    >
      <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function formatDocumentStatus(document: MarkdownDocument | undefined): string {
  if (!document) {
    return "Ready to open Markdown";
  }

  const sourceLabel = document.source === "remote" ? "Link" : "Local";

  return `${sourceLabel} - ${document.markdown.length.toLocaleString()} characters`;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong while opening that Markdown document.";
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    backgroundColor: "#172033",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    minWidth: 72,
    paddingHorizontal: 13
  },
  actionButtonAccent: {
    backgroundColor: colors.accentStrong,
    borderColor: "#388bfd"
  },
  actionButtonDisabled: {
    opacity: 0.45
  },
  actionButtonPressed: {
    backgroundColor: colors.panelBgActive
  },
  actionButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18
  },
  actionButtonTextAccent: {
    color: "#ffffff"
  },
  appTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 24
  },
  clearChip: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 12
  },
  clearChipText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700"
  },
  controls: {
    backgroundColor: colors.topbarBg,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    gap: 10,
    paddingBottom: 12,
    paddingHorizontal: 12,
    paddingTop: 10
  },
  documentStatus: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17
  },
  githubPanel: {
    backgroundColor: colors.panelBg,
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    gap: 9,
    padding: 10
  },
  githubPanelHeader: {
    gap: 2
  },
  githubPanelHint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16
  },
  githubPanelTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 18
  },
  githubTokenActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  githubTokenInput: {
    backgroundColor: colors.appBg,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    height: 40,
    paddingHorizontal: 11
  },
  modeButton: {
    alignItems: "center",
    borderRadius: 5,
    height: 32,
    justifyContent: "center",
    minWidth: 70,
    paddingHorizontal: 10
  },
  modeButtonActive: {
    backgroundColor: colors.panelBgActive
  },
  modeButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700"
  },
  modeButtonTextActive: {
    color: colors.text
  },
  modeSwitcher: {
    backgroundColor: colors.appBg,
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: "row",
    gap: 3,
    padding: 3
  },
  primaryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  readerStage: {
    flex: 1,
    minHeight: 0
  },
  recentChip: {
    backgroundColor: colors.accentDim,
    borderColor: "#234d77",
    borderRadius: 999,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    maxWidth: 168,
    paddingHorizontal: 12
  },
  recentChipText: {
    color: "#d7f7ff",
    fontSize: 12,
    fontWeight: "700"
  },
  recentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  safeArea: {
    backgroundColor: colors.appBg,
    flex: 1
  },
  shell: {
    backgroundColor: colors.appBg,
    flex: 1
  },
  statusBanner: {
    alignItems: "center",
    backgroundColor: "#101827",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 10
  },
  statusBannerError: {
    backgroundColor: "#241313",
    borderColor: "#6b2525"
  },
  statusBannerSuccess: {
    backgroundColor: "#0f221a",
    borderColor: "#265c40"
  },
  statusText: {
    color: colors.textSoft,
    flex: 1,
    fontSize: 13,
    lineHeight: 18
  },
  statusTextError: {
    color: "#ffc4c0"
  },
  statusTextSuccess: {
    color: "#b9f6ca"
  },
  titleBlock: {
    flex: 1,
    minWidth: 0
  },
  topbar: {
    alignItems: "center",
    backgroundColor: colors.topbarBg,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  urlInput: {
    backgroundColor: colors.appBg,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: 14,
    height: 40,
    minWidth: 0,
    paddingHorizontal: 11
  },
  urlRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  }
});

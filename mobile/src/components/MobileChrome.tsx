import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  TextInput,
  View
} from "react-native";

import type { GitHubCredentialsSession } from "../hooks/useGitHubCredentials";
import type { MobileDocumentSession } from "../hooks/useMobileDocumentSession";
import { appStyles as styles } from "../appStyles";
import { colors } from "../theme";
import type { LoadStatus, ReaderMode } from "../types";

interface MobileTopbarProps {
  readonly documentStatus: string;
  readonly onModeChange: (mode: ReaderMode) => void;
  readonly readerMode: ReaderMode;
}

export function MobileTopbar({
  documentStatus,
  onModeChange,
  readerMode
}: MobileTopbarProps) {
  return (
    <View style={styles.topbar}>
      <View style={styles.brandLockup}>
        <Image
          accessibilityIgnoresInvertColors
          accessible={false}
          source={require("../../assets/brand-icon.png")}
          style={styles.brandIcon}
        />
        <View style={styles.titleBlock}>
          <Text numberOfLines={1} style={styles.appTitle}>
            Markflow
          </Text>
          <Text numberOfLines={1} style={styles.documentStatus}>
            {documentStatus}
          </Text>
        </View>
      </View>

      <View style={styles.modeSwitcher} accessibilityRole="tablist">
        <ModeButton
          active={readerMode === "rendered"}
          label="Reader"
          onPress={() => onModeChange("rendered")}
        />
        <ModeButton
          active={readerMode === "source"}
          label="Source"
          onPress={() => onModeChange("source")}
        />
      </View>
    </View>
  );
}

interface MobileControlsProps {
  readonly documents: MobileDocumentSession;
  readonly github: GitHubCredentialsSession;
  readonly isLoading: boolean;
}

export function MobileControls({ documents, github, isLoading }: MobileControlsProps) {
  const hasGitHubToken = Boolean(github.token);

  return (
    <View style={styles.controls}>
      <View style={styles.primaryActions}>
        <ActionButton disabled={isLoading} label="Local" onPress={() => void documents.pickLocal()} />
        <ActionButton
          disabled={isLoading || documents.document?.source !== "remote"}
          label="Refresh"
          onPress={() => void documents.refresh()}
        />
        <ActionButton
          disabled={!documents.document}
          label="Share"
          onPress={() => void documents.share()}
        />
        <ActionButton
          disabled={isLoading}
          label={hasGitHubToken ? "GitHub On" : "GitHub"}
          onPress={github.togglePanel}
        />
      </View>

      <View style={styles.urlRow}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isLoading}
          keyboardType="url"
          onChangeText={documents.setUrlInput}
          onSubmitEditing={() => void documents.loadRemote()}
          placeholder="https://github.com/user/repo/blob/main/README.md"
          placeholderTextColor={colors.textMuted}
          returnKeyType="go"
          selectionColor={colors.accent}
          style={styles.urlInput}
          value={documents.urlInput}
        />
        <ActionButton
          disabled={isLoading}
          label="Load"
          onPress={() => void documents.loadRemote()}
          variant="accent"
        />
      </View>

      {github.panelOpen ? (
        <View style={styles.githubPanel}>
          <View style={styles.githubPanelHeader}>
            <Text style={styles.githubPanelTitle}>GitHub access</Text>
            <Text style={styles.githubPanelHint}>Fine-grained PAT, Contents: read</Text>
          </View>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
            onChangeText={github.setInput}
            placeholder={hasGitHubToken ? "Token saved" : "github_pat_..."}
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
            secureTextEntry
            selectionColor={colors.accent}
            style={styles.githubTokenInput}
            value={github.input}
          />
          <View style={styles.githubTokenActions}>
            <ActionButton
              disabled={isLoading || github.input.trim().length === 0}
              label="Save"
              onPress={() => void github.save()}
              variant="accent"
            />
            <ActionButton
              disabled={isLoading || !hasGitHubToken}
              label="Clear"
              onPress={() => void github.clear()}
            />
          </View>
        </View>
      ) : null}

      {documents.recentDocuments.length > 0 ? (
        <View style={styles.recentRow}>
          {documents.recentDocuments.slice(0, 3).map((recentDocument) => (
            <Pressable
              accessibilityRole="button"
              key={recentDocument.id}
              onPress={() => void documents.selectRecent(recentDocument)}
              style={styles.recentChip}
            >
              <Text numberOfLines={1} style={styles.recentChipText}>
                {recentDocument.title}
              </Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => void documents.clearRecents()}
            style={styles.clearChip}
          >
            <Text style={styles.clearChipText}>Clear</Text>
          </Pressable>
        </View>
      ) : null}

      <StatusBanner status={documents.status} />
      <StatusBanner status={github.status} />
    </View>
  );
}

interface ActionButtonProps {
  readonly disabled?: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: "default" | "accent";
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
      <Text style={[styles.actionButtonText, variant === "accent" && styles.actionButtonTextAccent]}>
        {label}
      </Text>
    </Pressable>
  );
}

interface ModeButtonProps {
  readonly active: boolean;
  readonly label: string;
  readonly onPress: () => void;
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

function StatusBanner({ status }: { readonly status: LoadStatus }) {
  if (status.kind === "idle") {
    return null;
  }

  return (
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
  );
}

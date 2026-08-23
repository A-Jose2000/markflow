import { StyleSheet } from "react-native";

import { colors } from "./theme";

export const appStyles = StyleSheet.create({
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
  brandIcon: {
    borderRadius: 7,
    flexShrink: 0,
    height: 32,
    width: 32
  },
  brandLockup: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 9,
    minWidth: 0
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

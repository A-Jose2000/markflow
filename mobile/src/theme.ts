import { Platform, StyleSheet } from "react-native";

export const colors = {
  appBg: "#0d1117",
  topbarBg: "#0b1018",
  panelBg: "#111827",
  panelBgActive: "#1f2937",
  border: "#30363d",
  borderStrong: "#3d4b60",
  text: "#e6edf3",
  textSoft: "#c9d1d9",
  textMuted: "#8b949e",
  accent: "#58a6ff",
  accentStrong: "#1f6feb",
  accentDim: "#10243b",
  codeBg: "#161b22",
  codeText: "#ffb86c",
  danger: "#f85149"
};

export const monoFont = Platform.select({
  android: "monospace",
  ios: "Menlo",
  default: "monospace"
});

export const markdownStyles = StyleSheet.create({
  body: {
    color: colors.textSoft,
    fontSize: 16,
    lineHeight: 26
  },
  heading1: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 36,
    marginBottom: 14,
    marginTop: 8
  },
  heading2: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 31,
    marginBottom: 12,
    marginTop: 24
  },
  heading3: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 27,
    marginBottom: 10,
    marginTop: 20
  },
  heading4: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 25,
    marginBottom: 8,
    marginTop: 16
  },
  paragraph: {
    marginBottom: 14
  },
  strong: {
    color: colors.text,
    fontWeight: "800"
  },
  em: {
    color: colors.textSoft,
    fontStyle: "italic"
  },
  link: {
    color: colors.accent
  },
  blockquote: {
    backgroundColor: "#101827",
    borderColor: colors.borderStrong,
    borderLeftWidth: 4,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  bullet_list: {
    marginBottom: 12
  },
  ordered_list: {
    marginBottom: 12
  },
  list_item: {
    color: colors.textSoft,
    lineHeight: 25,
    marginBottom: 5
  },
  code_inline: {
    backgroundColor: colors.codeBg,
    borderColor: colors.border,
    borderRadius: 5,
    borderWidth: 1,
    color: colors.codeText,
    fontFamily: monoFont,
    fontSize: 14,
    paddingHorizontal: 5,
    paddingVertical: 2
  },
  fence: {
    backgroundColor: colors.codeBg,
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    color: colors.textSoft,
    fontFamily: monoFont,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 16,
    padding: 14
  },
  code_block: {
    backgroundColor: colors.codeBg,
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    color: colors.textSoft,
    fontFamily: monoFont,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 16,
    padding: 14
  },
  hr: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: 22
  },
  table: {
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    marginBottom: 16
  },
  th: {
    backgroundColor: colors.panelBg,
    borderColor: colors.border,
    color: colors.text,
    fontWeight: "800",
    padding: 8
  },
  tr: {
    borderColor: colors.border,
    borderBottomWidth: 1
  },
  td: {
    borderColor: colors.border,
    color: colors.textSoft,
    padding: 8
  }
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MarkdownDocument } from "../types";

const LAST_DOCUMENT_KEY = "markflow:last-document:v1";
const RECENT_DOCUMENTS_KEY = "markflow:recent-documents:v1";
const MAX_RECENT_DOCUMENTS = 6;

export async function loadLastDocument(): Promise<MarkdownDocument | undefined> {
  const rawDocument = await AsyncStorage.getItem(LAST_DOCUMENT_KEY);

  return parseStoredDocument(rawDocument);
}

export async function loadRecentDocuments(): Promise<MarkdownDocument[]> {
  const rawDocuments = await AsyncStorage.getItem(RECENT_DOCUMENTS_KEY);

  if (!rawDocuments) {
    return [];
  }

  try {
    const parsedDocuments: unknown = JSON.parse(rawDocuments);

    if (!Array.isArray(parsedDocuments)) {
      return [];
    }

    return parsedDocuments.filter(isMarkdownDocument).slice(0, MAX_RECENT_DOCUMENTS);
  } catch {
    return [];
  }
}

export async function saveDocumentSnapshot(document: MarkdownDocument): Promise<MarkdownDocument[]> {
  const currentDocuments = await loadRecentDocuments();
  const nextDocuments = [
    document,
    ...currentDocuments.filter((currentDocument) => currentDocument.origin !== document.origin)
  ].slice(0, MAX_RECENT_DOCUMENTS);

  await AsyncStorage.multiSet([
    [LAST_DOCUMENT_KEY, JSON.stringify(document)],
    [RECENT_DOCUMENTS_KEY, JSON.stringify(nextDocuments)]
  ]);

  return nextDocuments;
}

export async function clearDocumentSnapshots(): Promise<void> {
  await AsyncStorage.multiRemove([LAST_DOCUMENT_KEY, RECENT_DOCUMENTS_KEY]);
}

function parseStoredDocument(rawDocument: string | null): MarkdownDocument | undefined {
  if (!rawDocument) {
    return undefined;
  }

  try {
    const parsedDocument: unknown = JSON.parse(rawDocument);

    return isMarkdownDocument(parsedDocument) ? parsedDocument : undefined;
  } catch {
    return undefined;
  }
}

function isMarkdownDocument(value: unknown): value is MarkdownDocument {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MarkdownDocument>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    (candidate.source === "local" || candidate.source === "remote") &&
    typeof candidate.origin === "string" &&
    typeof candidate.markdown === "string" &&
    typeof candidate.loadedAt === "string"
  );
}

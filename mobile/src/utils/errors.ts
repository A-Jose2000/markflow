export function messageFromError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong while opening that Markdown document.";
}

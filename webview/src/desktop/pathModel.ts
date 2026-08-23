import type { DesktopEntryMutationResult, DesktopFileTarget } from "./contracts";

export function getDesktopParentPath(relativePath: string): string {
  const separatorIndex = relativePath.lastIndexOf("/");
  return separatorIndex < 0 ? "" : relativePath.slice(0, separatorIndex);
}

export function isDesktopPathWithinOrEqual(parentPath: string, candidatePath: string): boolean {
  return parentPath === "" || candidatePath === parentPath || candidatePath.startsWith(`${parentPath}/`);
}

export function relocateDesktopPath(
  relativePath: string,
  result: Pick<DesktopEntryMutationResult, "previousRelativePath" | "entry">
): string {
  if (relativePath === result.previousRelativePath) {
    return result.entry.relativePath;
  }

  return `${result.entry.relativePath}${relativePath.slice(result.previousRelativePath.length)}`;
}

export function relocateDesktopTarget(
  target: DesktopFileTarget,
  result: Pick<DesktopEntryMutationResult, "previousRelativePath" | "entry">
): DesktopFileTarget {
  if (target.relativePath === result.previousRelativePath && result.entry.kind !== "directory") {
    return {
      rootId: target.rootId,
      ...result.entry
    };
  }

  const relativePath = relocateDesktopPath(target.relativePath, result);
  const separatorIndex = relativePath.lastIndexOf("/");

  return {
    ...target,
    relativePath,
    name: separatorIndex < 0 ? relativePath : relativePath.slice(separatorIndex + 1)
  };
}

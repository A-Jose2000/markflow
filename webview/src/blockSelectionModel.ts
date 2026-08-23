export interface HierarchySelectionUnit {
  key: string;
  scopeKey: string;
}

export interface HierarchySelectionScope {
  key: string;
  parentUnitKey?: string;
  unitKeys: readonly string[];
}

export interface HierarchySelectionModel {
  scopes: ReadonlyMap<string, HierarchySelectionScope>;
  units: ReadonlyMap<string, HierarchySelectionUnit>;
}

export interface CanonicalBlockSelection {
  scopeKey: string;
  keys: string[];
}

export function areBlockKeyListsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

export function resolveHierarchicalBlockSelection(
  model: HierarchySelectionModel,
  anchorKey: string,
  intersectingKeys: readonly string[]
): CanonicalBlockSelection | undefined {
  if (intersectingKeys.length === 0 || !model.units.has(anchorKey)) {
    return undefined;
  }

  const candidateKeys = Array.from(new Set([anchorKey, ...intersectingKeys]));

  for (const scopeKey of getUnitScopeChain(model, anchorKey)) {
    const scope = model.scopes.get(scopeKey);

    if (!scope) {
      continue;
    }

    const mappedKeys = candidateKeys.map((key) => getUnitKeyInScope(model, key, scopeKey));

    if (mappedKeys.some((key) => key === undefined)) {
      continue;
    }

    const selectedIndexes = mappedKeys.flatMap((key) => {
      const index = key ? scope.unitKeys.indexOf(key) : -1;
      return index >= 0 ? [index] : [];
    });

    if (selectedIndexes.length === 0) {
      continue;
    }

    const firstIndex = Math.min(...selectedIndexes);
    const lastIndex = Math.max(...selectedIndexes);
    return {
      scopeKey,
      keys: scope.unitKeys.slice(firstIndex, lastIndex + 1)
    };
  }

  return undefined;
}

export function getUnitKeyInScope(
  model: HierarchySelectionModel,
  unitKey: string,
  scopeKey: string
): string | undefined {
  let unit = model.units.get(unitKey);

  while (unit) {
    if (unit.scopeKey === scopeKey) {
      return unit.key;
    }

    const parentUnitKey = model.scopes.get(unit.scopeKey)?.parentUnitKey;
    unit = parentUnitKey ? model.units.get(parentUnitKey) : undefined;
  }

  return undefined;
}

function getUnitScopeChain(model: HierarchySelectionModel, unitKey: string): string[] {
  const scopeKeys: string[] = [];
  let unit = model.units.get(unitKey);

  while (unit) {
    scopeKeys.push(unit.scopeKey);
    const parentUnitKey = model.scopes.get(unit.scopeKey)?.parentUnitKey;
    unit = parentUnitKey ? model.units.get(parentUnitKey) : undefined;
  }

  return Array.from(new Set(scopeKeys));
}

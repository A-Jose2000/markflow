import type { NodeKey } from "lexical";

export interface SlashMarker {
  textNodeKey: NodeKey;
  offset: number;
}

export interface BlockCommandMenuState {
  targetKey: NodeKey;
  targetKeys?: NodeKey[];
  left: number;
  top: number;
  source: "context" | "plus" | "slash";
  slashMarker?: SlashMarker;
}

export interface PreparedBlockCommandTargets {
  targetKey: NodeKey;
  targetKeys: NodeKey[];
}

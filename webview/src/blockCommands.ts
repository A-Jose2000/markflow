export type BlockCommandKind =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "number-list"
  | "check-list"
  | "toggle"
  | "quote"
  | "code"
  | "table"
  | "divider";

export interface BlockCommand {
  id: BlockCommandKind;
  label: string;
  description: string;
  icon: string;
  keywords: string;
}

export type BlockCommandPlan =
  | { kind: "element"; element: "paragraph" | "heading-1" | "heading-2" | "heading-3" | "quote" }
  | { kind: "list"; listType: "bullet" | "number" | "check" }
  | { kind: "toggle" }
  | { kind: "code" }
  | { kind: "table" }
  | { kind: "divider" };

export const BLOCK_COMMAND_PLANS = {
  paragraph: { kind: "element", element: "paragraph" },
  "heading-1": { kind: "element", element: "heading-1" },
  "heading-2": { kind: "element", element: "heading-2" },
  "heading-3": { kind: "element", element: "heading-3" },
  "bullet-list": { kind: "list", listType: "bullet" },
  "number-list": { kind: "list", listType: "number" },
  "check-list": { kind: "list", listType: "check" },
  toggle: { kind: "toggle" },
  quote: { kind: "element", element: "quote" },
  code: { kind: "code" },
  table: { kind: "table" },
  divider: { kind: "divider" }
} as const satisfies Readonly<Record<BlockCommandKind, BlockCommandPlan>>;

export const BLOCK_COMMANDS: readonly BlockCommand[] = [
  {
    id: "paragraph",
    label: "Text",
    description: "Plain paragraph",
    icon: "T",
    keywords: "text paragraph plain body"
  },
  {
    id: "heading-1",
    label: "Heading 1",
    description: "Large section heading",
    icon: "H1",
    keywords: "title heading one h1"
  },
  {
    id: "heading-2",
    label: "Heading 2",
    description: "Medium section heading",
    icon: "H2",
    keywords: "subtitle heading two h2"
  },
  {
    id: "heading-3",
    label: "Heading 3",
    description: "Small section heading",
    icon: "H3",
    keywords: "heading three h3"
  },
  {
    id: "bullet-list",
    label: "Bulleted list",
    description: "Create a simple list",
    icon: "\u2022",
    keywords: "bullet unordered list"
  },
  {
    id: "number-list",
    label: "Numbered list",
    description: "Create an ordered list",
    icon: "1.",
    keywords: "number ordered list"
  },
  {
    id: "check-list",
    label: "To-do list",
    description: "Track tasks with checkboxes",
    icon: "\u2713",
    keywords: "todo task checkbox check list"
  },
  {
    id: "toggle",
    label: "Toggle",
    description: "Collapse nested blocks",
    icon: "\u25b8",
    keywords: "toggle disclosure collapse expand details"
  },
  {
    id: "quote",
    label: "Quote",
    description: "Capture a quotation",
    icon: "\u201c",
    keywords: "quote blockquote citation"
  },
  {
    id: "code",
    label: "Code block",
    description: "Insert a fenced code block",
    icon: "</>",
    keywords: "code programming source fence"
  },
  {
    id: "table",
    label: "Table",
    description: "Insert a 3 by 3 table",
    icon: "\u25a6",
    keywords: "table grid rows columns"
  },
  {
    id: "divider",
    label: "Divider",
    description: "Separate sections",
    icon: "\u2014",
    keywords: "divider separator horizontal rule line"
  }
];

const TURN_INTO_BLOCK_COMMANDS = BLOCK_COMMANDS.filter(
  (command) => command.id !== "table" && command.id !== "divider"
);

export function filterBlockCommands(
  query: string,
  turnIntoOnly: boolean
): readonly BlockCommand[] {
  const commands = turnIntoOnly ? TURN_INTO_BLOCK_COMMANDS : BLOCK_COMMANDS;
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return commands;
  }

  return commands.filter((command) =>
    `${command.label} ${command.description} ${command.keywords}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  );
}

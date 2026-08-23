import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject
} from "react";
import { createPortal } from "react-dom";

import type { BlockCommand } from "./blockCommands";
import type { BlockCommandMenuState } from "./blockCommandTypes";

interface BlockCommandMenuProps {
  activeCommandIndex: number;
  commands: readonly BlockCommand[];
  menu: BlockCommandMenuState;
  menuRef: RefObject<HTMLElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onActiveCommandChange: (index: number) => void;
  onApply: (command: BlockCommand) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onQueryChange: (query: string) => void;
}

export function BlockCommandMenu({
  activeCommandIndex,
  commands,
  inputRef,
  menu,
  menuRef,
  onActiveCommandChange,
  onApply,
  onKeyDown,
  onQueryChange,
  query
}: BlockCommandMenuProps) {
  const activeCommand = commands[activeCommandIndex];

  return createPortal(
    <section
      ref={menuRef}
      aria-label={menu.source === "context" ? "Turn blocks into" : "Block menu"}
      className="markflow-block-command-menu"
      style={{ left: `${menu.left}px`, top: `${menu.top}px` }}
    >
      <label className="markflow-block-command-search">
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <circle cx="7" cy="7" r="4.25" />
          <path d="m10.2 10.2 3.1 3.1" />
        </svg>
        <span className="visually-hidden">Search blocks</span>
        <input
          ref={inputRef}
          aria-activedescendant={activeCommand ? `markflow-block-command-${activeCommand.id}` : undefined}
          aria-controls="markflow-block-command-list"
          aria-label="Search blocks"
          autoComplete="off"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder={menu.source === "context" ? "Search block types..." : "Search blocks..."}
          role="combobox"
          spellCheck={false}
          value={query}
        />
      </label>
      <div className="markflow-block-command-caption">
        {menu.source === "context"
          ? `Turn ${menu.targetKeys?.length === 1 ? "block" : `${menu.targetKeys?.length ?? 1} blocks`} into`
          : "Basic blocks"}
      </div>
      <div id="markflow-block-command-list" className="markflow-block-command-list" role="listbox">
        {commands.length > 0 ? commands.map((command, index) => (
          <button
            key={command.id}
            id={`markflow-block-command-${command.id}`}
            aria-selected={index === activeCommandIndex}
            className="markflow-block-command-option"
            data-active={index === activeCommandIndex}
            onClick={() => onApply(command)}
            onMouseDown={(event: ReactMouseEvent<HTMLButtonElement>) => event.preventDefault()}
            onMouseEnter={() => onActiveCommandChange(index)}
            role="option"
            type="button"
          >
            <span aria-hidden="true" className="markflow-block-command-icon">
              {command.icon}
            </span>
            <span>
              <strong>{command.label}</strong>
              <small>{command.description}</small>
            </span>
          </button>
        )) : (
          <p className="markflow-block-command-empty">No blocks found</p>
        )}
      </div>
      {menu.source === "slash" && query.length === 0 ? (
        <p className="markflow-block-command-hint">Space closes · Backspace/Delete removes /</p>
      ) : null}
    </section>,
    document.body
  );
}

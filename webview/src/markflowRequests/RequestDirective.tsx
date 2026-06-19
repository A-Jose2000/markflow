import type { DirectiveDescriptor, DirectiveEditorProps } from "@mdxeditor/editor";
import type { ContainerDirective } from "mdast-util-directive";
import {
  MARKFLOW_REQUEST_DIRECTIVE_NAME,
  normalizeMarkflowRequestStatus,
  normalizeMarkflowRequestType
} from "./types";

type MdxEditorModule = typeof import("@mdxeditor/editor");

interface MarkflowRequestDirectiveNode extends ContainerDirective {
  name: typeof MARKFLOW_REQUEST_DIRECTIVE_NAME;
}

export function createMarkflowRequestDirectiveDescriptor(
  editorModule: MdxEditorModule
): DirectiveDescriptor<MarkflowRequestDirectiveNode> {
  const { NestedLexicalEditor, useLexicalNodeRemove, useMdastNodeUpdater } = editorModule;

  function MarkflowRequestDirectiveEditor({
    mdastNode
  }: DirectiveEditorProps<MarkflowRequestDirectiveNode>): JSX.Element {
    const removeNode = useLexicalNodeRemove();
    const updateMdastNode = useMdastNodeUpdater<MarkflowRequestDirectiveNode>();
    const attributes = mdastNode.attributes ?? {};
    const requestId = typeof attributes.id === "string" && attributes.id.trim().length > 0 ? attributes.id : "missing-id";
    const status = normalizeMarkflowRequestStatus(attributes.status);
    const requestType = normalizeMarkflowRequestType(attributes.type);

    return (
      <section className="markflow-request-card" data-status={status}>
        <header className="markflow-request-card-header">
          <span className="markflow-request-card-emoji" aria-hidden="true">
            🤖
          </span>
          <div>
            <strong>Markflow Request</strong>
            <span>{requestId}</span>
          </div>
          <span className="markflow-request-card-pill">{status}</span>
          <span className="markflow-request-card-pill">{requestType}</span>
          <div className="markflow-request-card-actions">
            <button
              className="markflow-request-card-action"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                updateMdastNode({
                  children: [...mdastNode.children, ...createFollowUpTurn()]
                });
              }}
              type="button"
            >
              Add follow-up
            </button>
            <button
              className="markflow-request-card-action markflow-request-card-delete"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                removeNode();
              }}
              type="button"
            >
              Delete
            </button>
          </div>
        </header>

        <div className="markflow-request-card-body">
          <NestedLexicalEditor<MarkflowRequestDirectiveNode>
            block
            contentEditableProps={{
              className: "markflow-request-card-editor",
              "aria-label": "Markflow request body"
            }}
            getContent={(node) => node.children}
            getUpdatedMdastNode={(node, children) => ({
              ...node,
              children: children as MarkflowRequestDirectiveNode["children"]
            })}
          />
        </div>
      </section>
    );
  }

  return {
    name: MARKFLOW_REQUEST_DIRECTIVE_NAME,
    attributes: ["id", "status", "type"],
    hasChildren: true,
    type: "containerDirective",
    testNode(node): node is MarkflowRequestDirectiveNode {
      return node.type === "containerDirective" && node.name === MARKFLOW_REQUEST_DIRECTIVE_NAME;
    },
    Editor: MarkflowRequestDirectiveEditor
  };
}

function createFollowUpTurn(): MarkflowRequestDirectiveNode["children"] {
  return [createChatParagraph("You", "Ask a follow-up here.")];
}

function createChatParagraph(role: "You" | "Assistant", content: string): MarkflowRequestDirectiveNode["children"][number] {
  return {
    type: "paragraph",
    children: [
      {
        type: "strong",
        children: [
          {
            type: "text",
            value: `${role}:`
          }
        ]
      },
      ...(content.length > 0
        ? [
            {
              type: "text" as const,
              value: ` ${content}`
            }
          ]
        : [])
    ]
  };
}

import { $getNodeByKey, DecoratorNode, type EditorConfig, type LexicalEditor, type LexicalNode, type NodeKey, type SerializedLexicalNode } from "lexical";
import type { InlineMath, Math as FlowMath } from "mdast-util-math";
import { mathFromMarkdown, mathToMarkdown } from "mdast-util-math";
import { math } from "micromark-extension-math";
import { useEffect, useMemo, useState } from "react";
import katex from "katex";
import type { MdxEditorModule } from "./App";

type MathMdastNode = InlineMath | FlowMath;

interface SerializedMathNode extends SerializedLexicalNode {
  formula: string;
  inline: boolean;
}

interface MathPreviewProps {
  formula: string;
  inline: boolean;
  nodeKey: string;
  onCommit: (formula: string) => void;
  readOnly: boolean;
}

function MathPreview({ formula, inline, nodeKey, onCommit, readOnly }: MathPreviewProps): JSX.Element {
  const [isSourceVisible, setIsSourceVisible] = useState(false);
  const [draftFormula, setDraftFormula] = useState(formula);

  useEffect(() => {
    if (!isSourceVisible) {
      setDraftFormula(formula);
    }
  }, [formula, isSourceVisible]);

  const rendered = useMemo(
    () =>
      katex.renderToString(formula, {
        displayMode: !inline,
        throwOnError: false,
        trust: false
      }),
    [formula, inline]
  );

  const source = inline ? `$${formula}$` : `$$\n${formula}\n$$`;
  const sourceId = `markflow-math-source-${nodeKey.replaceAll(":", "-")}`;

  function commitFormula(): void {
    const nextFormula = draftFormula.trim();

    if (nextFormula.length === 0 || nextFormula === formula) {
      setDraftFormula(formula);
      setIsSourceVisible(false);
      return;
    }

    onCommit(nextFormula);
    setIsSourceVisible(false);
  }

  return (
    <span className={inline ? "markflow-math-widget markflow-math-widget--inline" : "markflow-math-widget"}>
      <span
        className={inline ? "markflow-math markflow-math--inline" : "markflow-math markflow-math--block"}
        data-markflow-latex={formula}
        title={source}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />

      <span className="markflow-math-actions" aria-label="LaTeX formula controls">
        <button
          aria-controls={sourceId}
          aria-expanded={isSourceVisible}
          className="markflow-math-action"
          onClick={() => {
            setIsSourceVisible((current) => !current);
          }}
          title={isSourceVisible ? "Hide LaTeX source" : "Show LaTeX source"}
          type="button"
        >
          {isSourceVisible ? "Hide" : "Source"}
        </button>
      </span>

      {isSourceVisible ? (
        <span className="markflow-math-source-panel" id={sourceId}>
          <textarea
            aria-label="LaTeX source"
            className="markflow-math-source-input"
            onChange={(event) => setDraftFormula(event.currentTarget.value)}
            readOnly={readOnly}
            rows={inline ? 1 : Math.max(3, draftFormula.split("\n").length)}
            spellCheck={false}
            value={draftFormula}
          />
          <span className="markflow-math-source-actions">
            {readOnly ? null : (
              <button className="markflow-math-source-button" onClick={commitFormula} type="button">
                Save
              </button>
            )}
            <button
              className="markflow-math-source-button"
              onClick={() => {
                setDraftFormula(formula);
                setIsSourceVisible(false);
              }}
              type="button"
            >
              Close
            </button>
          </span>
        </span>
      ) : null}
    </span>
  );
}

class MathNode extends DecoratorNode<JSX.Element> {
  __formula: string;
  __inline: boolean;

  static getType(): string {
    return "markflow-math";
  }

  static clone(node: MathNode): MathNode {
    return new MathNode(node.__formula, node.__inline, node.__key);
  }

  static importJSON(serializedNode: SerializedMathNode): MathNode {
    return $createMathNode(serializedNode.formula, serializedNode.inline);
  }

  constructor(formula: string, inline: boolean, key?: NodeKey) {
    super(key);
    this.__formula = formula;
    this.__inline = inline;
  }

  exportJSON(): SerializedMathNode {
    return {
      ...super.exportJSON(),
      formula: this.getFormula(),
      inline: this.isInline(),
      type: "markflow-math",
      version: 1
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement(this.__inline ? "span" : "div");
    element.className = this.__inline ? "markflow-math-node markflow-math-node--inline" : "markflow-math-node";
    return element;
  }

  updateDOM(previousNode: MathNode): boolean {
    return previousNode.__inline !== this.__inline;
  }

  decorate(editor: LexicalEditor): JSX.Element {
    const nodeKey = this.getKey();

    return (
      <MathPreview
        formula={this.getFormula()}
        inline={this.isInline()}
        nodeKey={nodeKey}
        readOnly={!editor.isEditable()}
        onCommit={(formula) => {
          editor.update(() => {
            const node = $getNodeByKey(nodeKey);

            if ($isMathNode(node)) {
              node.setFormula(formula);
            }
          });
        }}
      />
    );
  }

  getFormula(): string {
    return this.getLatest().__formula;
  }

  isInline(): boolean {
    return this.getLatest().__inline;
  }

  setFormula(formula: string): void {
    this.getWritable().__formula = formula;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }
}

function $createMathNode(formula: string, inline: boolean): MathNode {
  return new MathNode(formula, inline);
}

function $isMathNode(node: LexicalNode | null | undefined): node is MathNode {
  return node instanceof MathNode;
}

export function markflowMathPlugin(editorModule: MdxEditorModule): ReturnType<MdxEditorModule["realmPlugin"]> {
  const { realmPlugin, addSyntaxExtension$, addMdastExtension$, addToMarkdownExtension$, addImportVisitor$, addLexicalNode$, addExportVisitor$ } =
    editorModule;

  return realmPlugin({
    init(realm) {
      realm.pubIn({
        [addSyntaxExtension$]: math({ singleDollarTextMath: true }),
        [addMdastExtension$]: mathFromMarkdown(),
        [addToMarkdownExtension$]: mathToMarkdown(),
        [addImportVisitor$]: {
          testNode: (mdastNode): mdastNode is MathMdastNode =>
            mdastNode.type === "inlineMath" || mdastNode.type === "math",
          visitNode({ mdastNode, lexicalParent }) {
            lexicalParent.append($createMathNode(mdastNode.value, mdastNode.type === "inlineMath"));
          }
        },
        [addLexicalNode$]: MathNode,
        [addExportVisitor$]: {
          testLexicalNode: $isMathNode,
          visitLexicalNode({ actions, lexicalNode, mdastParent }) {
            actions.appendToParent(mdastParent, {
              type: lexicalNode.isInline() ? "inlineMath" : "math",
              value: lexicalNode.getFormula()
            });
          }
        }
      });
    }
  })();
}

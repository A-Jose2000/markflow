import { useEffect, useMemo, useState } from "react";
import type { RealmPlugin } from "@mdxeditor/editor";

import { createDraggableBlocksPlugin } from "../draggableBlocksPlugin";
import type { MdxEditorModule } from "../editorContract";
import { markflowMathPlugin } from "../mathPlugin";

export interface RichEditorRuntime {
  editorModule?: MdxEditorModule;
  loadError?: string;
  plugins: RealmPlugin[];
}

export function useRichEditorRuntime(): RichEditorRuntime {
  const [editorModule, setEditorModule] = useState<MdxEditorModule | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();

  useEffect(() => {
    let isDisposed = false;

    import("@mdxeditor/editor")
      .then((loadedModule) => {
        if (!isDisposed) {
          setEditorModule(loadedModule);
        }
      })
      .catch((error: unknown) => {
        if (isDisposed) {
          return;
        }

        const message = error instanceof Error ? error.message : "The rich Markdown editor failed to load.";
        console.error("Markflow could not load MDXEditor.", error);
        setLoadError(message);
      });

    return () => {
      isDisposed = true;
    };
  }, []);

  const plugins = useMemo(
    () => editorModule ? createRichEditorPlugins(editorModule) : [],
    [editorModule]
  );

  return { editorModule, loadError, plugins };
}

export function createRichEditorPlugins(editorModule: MdxEditorModule): RealmPlugin[] {
  return [
    editorModule.headingsPlugin(),
    editorModule.listsPlugin(),
    editorModule.quotePlugin(),
    editorModule.thematicBreakPlugin(),
    editorModule.linkPlugin(),
    editorModule.linkDialogPlugin(),
    editorModule.tablePlugin(),
    editorModule.codeBlockPlugin({ defaultCodeBlockLanguage: "txt" }),
    editorModule.codeMirrorPlugin({
      codeBlockLanguages: {
        bash: "Bash",
        css: "CSS",
        html: "HTML",
        js: "JavaScript",
        json: "JSON",
        jsx: "JSX",
        markdown: "Markdown",
        md: "Markdown",
        mermaid: "Mermaid",
        py: "Python",
        sql: "SQL",
        ts: "TypeScript",
        tsx: "TSX",
        txt: "Plain text",
        yaml: "YAML"
      }
    }),
    editorModule.frontmatterPlugin(),
    createDraggableBlocksPlugin(editorModule),
    markflowMathPlugin(editorModule),
    editorModule.diffSourcePlugin({ viewMode: "rich-text" }),
    editorModule.markdownShortcutPlugin(),
    editorModule.toolbarPlugin({
      toolbarContents: () => (
        <editorModule.DiffSourceToggleWrapper>
          <editorModule.UndoRedo />
          <editorModule.Separator />
          <editorModule.BlockTypeSelect />
          <editorModule.Separator />
          <editorModule.BoldItalicUnderlineToggles />
          <editorModule.CodeToggle />
          <editorModule.CreateLink />
          <editorModule.Separator />
          <editorModule.ListsToggle />
          <editorModule.Separator />
          <editorModule.InsertCodeBlock />
          <editorModule.InsertTable />
          <editorModule.InsertThematicBreak />
        </editorModule.DiffSourceToggleWrapper>
      )
    })
  ];
}

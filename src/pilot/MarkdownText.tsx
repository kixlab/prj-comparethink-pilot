import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Display only: the stored events and exports keep the model's raw text.
// Raw HTML in model output is not rendered, and unsafe link protocols are dropped by react-markdown.
export default function MarkdownText({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          table: ({ node: _node, ...props }) => (
            <div className="markdown-table">
              <table {...props} />
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

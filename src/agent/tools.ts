import type Anthropic from "@anthropic-ai/sdk";

// The agent's tool set (canonical Anthropic schema; adapted per provider in llm.ts).
export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_file_contents",
    description:
      "Read the full contents of a file in the repository. Use this to understand existing code before proposing a fix.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the repo root, e.g. src/auth/session.ts",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description:
      "List the files and directories at a given path to explore the codebase structure.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: 'Directory path relative to repo root. Use "" for the root.',
        },
      },
      required: ["path"],
    },
  },
  {
    name: "search_code",
    description:
      "Search for a string across the repository using GitHub code search. Useful for finding where a function or symbol is defined or used.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The text to search for." },
      },
      required: ["query"],
    },
  },
  {
    name: "create_pull_request",
    description:
      "Create a branch with the fixed file(s) and open a pull request. Call this ONLY when you have a complete fix ready.",
    input_schema: {
      type: "object",
      properties: {
        branch_name: {
          type: "string",
          description: "Branch name for the fix, e.g. fix/null-user-in-get-user",
        },
        pr_title: { type: "string", description: "Concise, descriptive PR title." },
        pr_body: {
          type: "string",
          description:
            "PR description in Markdown with Root Cause, Fix, How to Verify, and Issue link sections.",
        },
        files: {
          type: "array",
          description: "Files to create or update in the commit.",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path in the repo." },
              content: {
                type: "string",
                description: "The full new content of the file after the fix.",
              },
            },
            required: ["path", "content"],
          },
        },
      },
      required: ["branch_name", "pr_title", "pr_body", "files"],
    },
  },
];

import type { ToolSample } from "gui-chat-protocol";

export const samples: ToolSample[] = [
  {
    name: "Contact form",
    args: {
      title: "Contact us",
      description: "We'll get back to you shortly.",
      fields: [
        { id: "name", type: "text", label: "Your name", required: true },
        { id: "email", type: "text", label: "Email", validation: "email", required: true },
        { id: "topic", type: "dropdown", label: "Topic", choices: ["Sales", "Support", "Other"], required: true },
        { id: "message", type: "textarea", label: "Message", rows: 5, maxLength: 500, required: true },
      ],
    },
  },
  {
    name: "Survey",
    args: {
      title: "Quick survey",
      fields: [
        { id: "satisfaction", type: "radio", label: "How satisfied are you?", choices: ["Very", "Somewhat", "Not at all"], required: true },
        { id: "features", type: "checkbox", label: "Which features do you use?", choices: ["Search", "Export", "Sharing"] },
        { id: "since", type: "date", label: "Using since" },
      ],
    },
  },
];

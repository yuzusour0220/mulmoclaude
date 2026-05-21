// Cross-context entry — types + schemas that host components
// can import without dragging in the server's `definePlugin` factory
// or the runtime-loaded Vue components.

export { ContactSchema, RateSchema, ClientSchema, ProjectSchema } from "./types";

export type { Contact, Rate, Client, Project, ClientCandidate, ProjectCandidate } from "./types";

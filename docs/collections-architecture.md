# Collections — Applications as Data

This document describes Collections, a system for defining applications as data.

The broader idea is developed in *DSLs as Harnesses*: a domain-specific language can serve as a harness that constrains, validates, and structures an agent's reasoning.

Collections apply that idea to software itself.

A collection schema is not merely a database schema. It is a harness for an application.

The schema defines:

* the data model
* relationships
* user interface
* computations
* workflows

The records are data.

The schema is the application definition.

Claude is the runtime.

In traditional software, engineers write code that implements business logic.

In Collections, users define a structured environment, and Claude operates inside it.

Applications become data.

---

## The Core Idea

Traditional software requires four separate systems:

* A database
* An ORM
* A UI framework
* A workflow engine

Collections collapse all four into a single artifact that an LLM can author, understand, and operate.

A collection is not merely a schema.

It is a complete application definition.

```text
schema.json
+
records/*.json
+
Claude
=
Application
```

The files themselves are the source of truth.

There is no database server.

There is no migration framework.

There is no application-specific backend.

The host platform understands only generic capabilities.

Everything application-specific lives in the collection.

---

## Collections as Harnesses

A collection schema serves the same role that a harness serves for an agent.

It constrains what Claude can manipulate.

It validates what Claude creates.

It defines the structure through which Claude reasons about the application.

A collection is therefore not simply a database schema.

It is a domain-specific language for applications.

The schema becomes the environment in which the agent thinks.

The collection author is effectively designing the operating environment in which Claude will work.

This is the key distinction between Collections and traditional application frameworks.

---

## A Collection Is an Application

A single schema defines:

| Concern        | Collection DSL |
| -------------- | -------------- |
| Data Model     | Fields         |
| Relationships  | Ref / Embed    |
| User Interface | Field Types    |
| Computation    | Derived Fields |
| Workflow       | Actions        |

Traditional application frameworks spread these concerns across multiple technologies and codebases.

Collections keep them together.

A complete CRM, invoice system, project tracker, portfolio manager, restaurant guide, or personal database can be expressed entirely as:

```text
schema.json
+
records
```

No custom host code is required.

---

## Relationships as First-Class Concepts

Collections support two kinds of relationships.

### References

A `ref` field stores a reference to a record in another collection.

```json
{
  "type": "ref",
  "to": "clients"
}
```

The host automatically renders:

* relationship pickers
* links
* navigation
* lookup support

without collection-specific code.

### Embeds

An `embed` field displays a fixed record from another collection.

```json
{
  "type": "embed",
  "to": "profile",
  "id": "me"
}
```

This allows collections to compose information from multiple sources without duplicating data.

---

## Computation Without Code

Collections support derived fields.

```text
subtotal = sum(lineItems)
tax = subtotal * taxRate
total = subtotal + tax
```

A derived field behaves similarly to a spreadsheet formula.

Unlike spreadsheets, formulas can follow references into other collections.

```text
shares * ticker.price
```

This creates live relationships between collections without synchronization code.

A portfolio can automatically revalue itself when a quote changes elsewhere.

No copying is required.

No update jobs are required.

The schema defines the relationship.

The host computes the result.

---

## Business Logic as Language

Traditional application platforms attempt to encode business logic into increasingly complex DSLs, formula engines, and workflow systems.

Collections deliberately stop earlier.

The schema defines structure.

Claude provides judgment.

This boundary is intentional.

A good harness constrains what must be deterministic while leaving open what requires reasoning.

For example, a collection can declare that an invoice has a button:

```text
Record Payment
```

The schema specifies:

* when the button appears
* which role handles it
* which template is used

The actual accounting logic lives in natural language instructions.

Complex workflows such as:

* bookkeeping
* compliance
* reporting
* document generation
* business analysis

are often easier to express in prose than in a specialized language.

Collections embrace that reality.

> Business logic becomes language.

---

## User-Authored Harnesses

Most harnesses are designed by engineers.

Collections move harness design closer to the user.

By defining a schema, a user is effectively defining the environment in which Claude will operate.

The schema determines:

* what data exists
* what relationships are possible
* what actions can occur
* what constraints are enforced

In this sense, a collection author is not merely configuring software.

They are designing a harness.

This is the democratization of harness engineering.

The environment that guides the agent is no longer built exclusively by programmers.

It can be authored directly by the people who understand the domain.

---

## Claude as the Runtime

Claude is not merely an assistant layered on top of the application.

Claude is the runtime.

When a user invokes an action:

1. The host loads the record.
2. The host validates visibility and safety rules.
3. The host assembles a structured prompt.
4. Claude performs the task.

The host enforces structure.

Claude provides intelligence.

| Host       | Claude             |
| ---------- | ------------------ |
| Storage    | Judgment           |
| Validation | Reasoning          |
| Rendering  | Domain expertise   |
| Safety     | Workflow execution |

This division of responsibility is fundamental to the architecture.

---

## Zero Domain-Specific Host Code

The host platform contains no knowledge of invoices, accounting, portfolios, CRMs, restaurants, projects, or any other domain.

It understands only generic concepts:

* fields
* relationships
* derived values
* actions

Everything domain-specific lives in the collection.

Adding a new application means creating a new collection.

No host modifications are required.

This constraint is deliberate.

When extending the host, developers add generic capabilities.

When building applications, users define schemas.

The host gains power without accumulating domain knowledge.

---

## How Collections Differ

The key question is not what language a system uses.

The key question is who designs the environment in which the agent operates.

| System               | Who Designs The Environment? |
| -------------------- | ---------------------------- |
| Traditional Software | Engineers                    |
| Airtable             | Engineers                    |
| Retool               | Engineers                    |
| PowerApps            | Engineers                    |
| Collections          | Users                        |

Collections move harness design closer to domain experts.

Instead of adapting a workflow to software, users define the environment directly.

Claude then operates within that environment.

---

## Design Boundaries

Collections deliberately separate structural correctness from semantic correctness.

The host guarantees:

* schema validity
* path safety
* deterministic computation
* prompt isolation
* record storage

Claude owns:

* workflow decisions
* business reasoning
* semantic correctness
* domain expertise

This boundary is intentional.

The host handles what must be reliable.

Claude handles what requires judgment.

As capabilities mature, some responsibilities may move from the agent into the schema when doing so improves reliability or performance.

The guiding principle remains unchanged:

> Extend the declarative layer only when it outperforms the agent.

---

## From Programming to Harness Design

Collections are part of a broader shift in how software is created.

Traditional software assumes:

```text
Engineers write programs.
Users operate them.
```

Collections assume something different:

```text
Users define environments.
Agents operate within them.
```

The collection schema is that environment.

As software becomes increasingly AI-native, the role of development shifts from implementing behavior to designing harnesses.

Collections make that shift explicit.

The records are data.

The schema is the harness.

Claude is the runtime.

Applications become data.

Harnesses become software.

# Sample prompts for the Site24x7 expert agent

Vetted prompts to validate that your agent + the MCP server + the
persona are all wired up correctly. Each one is annotated with what
we expect the agent to do, so you can compare with what your agent
actually did.

> **Tip:** Run them in order. Each one builds on what the previous
> one exercised. **Prompts 1–4, 6 are read-only and safe** on any
> tenant; prompts 5 and 7 mutate state and the persona must ask for
> confirmation before doing so. Prompt 8 generates a verification
> report.

## How to use these

1. Install the server and wire it into your agent (see [`install.md`](install.md)).
2. Adopt the persona — copy [`AGENTS.md`](AGENTS.md) into whichever per-platform persona slot applies.
3. Paste a prompt below. Prompts that name specific monitors / customers (e.g. `"foo"`, `"Acme Corp"`) are written as templates — replace them with names from your tenant before sending.
4. **File a [verification report](https://github.com/jmpijll/site24x7-code-mode-mcp/issues/new?template=verification_report.yml)** with the agent, model, prompts you tried, and what happened. Prompt 8 below is designed to elicit one.

---

## 1. One-screen overview (read-only, single-tenant)

```text
Give me a one-screen overview of my Site24x7 account: total monitors,
how many are UP / DOWN / TROUBLE / CRITICAL, monitor-group count,
threshold-profile count, notification-profile count, and
location-profile count. Return as a small Markdown table and cite the
operation IDs you used.
```

**What the agent should do:**

1. Run `site24x7_search` with `searchOperations('current status', 5)` and `searchOperations('threshold profiles', 5)` (and equivalents) to confirm the operation IDs: `get_current_status`, `get_monitors`, `get_monitor_groups`, `get_threshold_profiles`, `get_notification_profiles`, `get_location_profiles`.
2. Issue **one** `site24x7_execute` call with a single `Promise.all` block that fans out across those six endpoints.
3. Render a Markdown table with the seven rows above and a final line listing the operation IDs used.

**Anti-pattern to look for:** the agent making six separate `site24x7_execute` calls. Functionally correct, but it shows the persona's "synthesise client-side" principle didn't land.

---

## 2. Monitor-type inventory (read-only, scope-discovery)

```text
What monitor types do I have configured in this Site24x7 account?
For each distinct monitor type (URL, REST_API, SERVER, AWS, RUM,
APM, etc.), tell me how many monitors I have of that type and what
percentage of the total they represent. Sort descending by count.
```

**What the agent should do:**

1. Confirm via `getOperation('get_monitors')` that `GET /api/monitors` returns each monitor with a `type` field.
2. Run **one** `site24x7_execute` that fetches `site24x7.monitors.list()`, groups client-side by `type`, computes the percentages, and returns a sorted array.
3. Render a Markdown table with `Type | Count | %` and a one-line total at the bottom.

**Anti-pattern to look for:** the agent calling `GET /api/monitors?type=URL` once per known type — that's both wrong (it has to enumerate the types first) and wasteful of the 50-call budget.

---

## 3. MSP fan-out — DOWN monitors per customer (read-only, MSP)

```text
For each of my customers, list any monitors that are currently DOWN.
Output a Markdown table with one row per customer (name + zaaid) and
the list of DOWN monitor display names (or "(none)" if all green).
End with a summary line: "<N> customers, <M> with at least one DOWN
monitor".
```

**What the agent should do:**

1. Run `site24x7_search` once to confirm `get_current_status` exists and accepts a per-customer `zaaid` cookie.
2. Run **one** `site24x7_execute`:

    ```js
    var customers = site24x7.listCustomers();
    var results = [];
    for (var i = 0; i < customers.length; i++) {
      var c = customers[i];
      var status = site24x7.withCustomer(c.zaaid, function (s) {
        return s.request({ method: 'GET', path: '/api/current_status' });
      });
      var downMons = ((status && status.monitors) || [])
        .filter(function (m) { return m.status === 0 || m.status === 1; });
      results.push({ name: c.name, zaaid: c.zaaid, down: downMons.map(function (m) { return m.name; }) });
    }
    results;
    ```

3. Render the table and the summary line.

**Anti-pattern to look for:** the agent reaching for `async`/`await` or `Promise.all` (calls are sync — no Promises in the sandbox), or calling `/api/current_status` once without `withCustomer` and pretending it covers every customer.

**Budget note:** with N > 40 customers this hits the 50-call budget. The agent should either page through (split across two `execute` calls) or warn the user up front.

---

## 4. MSP fan-out — act on a named customer (read-only, MSP)

```text
For the customer named "Acme Corp", give me the full list of their
URL monitors with their URL, status (UP / DOWN / TROUBLE / CRITICAL),
threshold-profile ID, and notification-profile ID.
```

**What the agent should do:**

1. Run `site24x7.listCustomers()` once; find the entry whose `name === 'Acme Corp'` (or `'acme corp'` — be case-insensitive in the lookup).
2. If not found, surface the available customer names and stop.
3. If found, wrap the rest in `site24x7.withCustomer(target.zaaid, function (s) { ... })`:

    ```js
    var customers = site24x7.listCustomers();
    var target = customers.find(function (c) { return c.name.toLowerCase() === 'acme corp'; });
    if (!target) {
      throw new Error(
        'customer "Acme Corp" not found; available: ' +
          customers.map(function (c) { return c.name; }).join(', '),
      );
    }
    site24x7.withCustomer(target.zaaid, function (s) {
      var monitors = s.monitors.list() || [];
      var urls = monitors.filter(function (m) { return m.type === 'URL'; });
      return { customer: target.name, zaaid: target.zaaid, monitors: urls };
    });
    ```

4. Render a Markdown table with `Name | URL | Status | Threshold | Notification`.
5. Cite operation IDs: `get_short_msp_customers`, `get_monitors`.

---

## 5. Confirm-before-mutate — suspend a monitor on a named customer (MSP)

```text
For the customer "Acme Corp", suspend the website monitor named
"foo". I want to take it offline for an hour while we troubleshoot.
```

**What the agent should do:**

1. **Does not mutate yet.** Instead, it:
    1. Looks up the customer (`site24x7.listCustomers()` → find `"Acme Corp"`).
    2. Inside `site24x7.withCustomer(zaaid, ...)`, runs `site24x7.monitors.list()` and finds the monitor with `name === 'foo'` and `type === 'URL'`.
    3. Confirms via `getOperation('put_monitors_suspend_monitor_id')` that the operation exists and takes `monitor_id` as a path arg.
2. **Replies with an explicit confirmation prompt** containing:
    - Operation ID: `put_monitors_suspend_monitor_id`
    - Method + path: `PUT /api/monitors/suspend/:monitor_id`
    - Target `monitor_id` (the literal numeric ID from step 1)
    - Customer name: `Acme Corp`
    - `zaaid`: the literal value from step 1
    - Expected resulting state: monitor moved to SUSPENDED
    - Reminder that this is reversible via `put_monitors_activate_monitor_id`
3. Waits for an explicit "yes, proceed" in the same turn before issuing the `site24x7_execute`.
4. After running, verifies with `GET /api/monitors/:monitor_id` (or `GET /api/current_status/:monitor_id`) that the state is now SUSPENDED and reports back.

**Anti-pattern to look for:** the agent runs the suspend without asking. The persona is explicit: any `Suspend*` / `Activate*` / `Delete*` operation requires confirmation **in this turn**, and for MSP operations the confirmation must include both the customer name and the `zaaid`.

---

## 6. IT Automation — list, inspect, dry-run (read-only)

```text
List every IT Automation action configured in my account. For each
one, show its name, type (URL / Server command / Webhook / Lambda /
ServiceNow), and which monitors / monitor-groups reference it. Then
tell me what the most recent execution looks like — pick any one
action and pull its log_report entry.
```

**What the agent should do:**

1. `searchOperations('it automation', 10)` confirms `get_it_automation`, `get_it_automation_action_id`, `get_it_automation_log_report`.
2. Run **one** `site24x7_execute` that fetches the action list, then `Promise.all`s the per-action detail fetches (respecting the 50-call budget — if there are >40 actions, fetch the list only and ask the user which one to drill into).
3. Render a Markdown table with `Name | Type | Referenced by`, then a small JSON block for the chosen log entry.
4. Cite operation IDs: `get_it_automation`, `get_it_automation_action_id`, `get_it_automation_log_report`.

**Anti-pattern to look for:** the agent calling `put_it_automation_execute` (which actually runs an action) when the user only asked to inspect. Read-only intent → read-only calls.

---

## 7. MSP report — fleet-wide DOWN/TROUBLE rollup with maintenance carve-out (read-only, MSP)

```text
Produce an MSP fleet report: for every customer under my portal,
tell me (1) how many monitors are UP, DOWN, TROUBLE, CRITICAL,
SUSPENDED, MAINTENANCE; (2) how many active schedule-maintenance
windows they have; (3) the count of monitor groups; (4) the total
number of IT Automation actions configured. End with a sorted list
of customers by DOWN+TROUBLE+CRITICAL count, descending — the most
"on fire" customers at the top.
```

**What the agent should do:**

1. `searchOperations('current status', 5)`, `searchOperations('maintenance', 10)`, `searchOperations('monitor groups', 5)`, `searchOperations('it automation', 5)` — confirm `get_current_status`, `get_maintenance`, `get_monitor_groups`, `get_it_automation`.
2. Run `site24x7.listCustomers()` once and **budget-check** before fan-out: this needs 4 calls per customer + 1 for the customer list, so for the default 50-call budget the limit is ~12 customers per `site24x7_execute`. The agent should either:
    - Chunk customers into batches of ≤12 and run multiple `site24x7_execute` calls, merging client-side, **or**
    - Tell the user up-front that the report will be split across multiple calls and confirm before proceeding.
3. Render: one Markdown table per customer (or one wide table with one row per customer), then the sorted "most on fire" list at the bottom.
4. Cite the four operation IDs used.

**Anti-pattern to look for:** the agent silently truncating the customer list to fit the budget, or running 4 × N separate `site24x7_execute` calls (one per (customer, operation) pair).

---

## 8. Verification report self-prompt (please file one!)

```text
You are a Site24x7 expert agent connected to the
site24x7-code-mode-mcp server. Take whatever model + agent platform
combination you're running on right now, run prompts 1, 2, 3, 4
above against this server, and at the end produce a filled-in
.github/ISSUE_TEMPLATE/verification_report.yml-shaped Markdown
document I can paste into a GitHub issue.

Include:
  - agent name + version
  - model
  - transport (stdio / streamable-http)
  - server version (use site24x7_search; the version is on the
    indexed spec metadata returned by getOperation or a no-arg
    searchOperations('') call)
  - zone (echo SITE24X7_ZONE)
  - account type (echo SITE24X7_ACCOUNT_TYPE)
  - the prompts you ran
  - the sanitized transcripts (redact monitor names, customer names,
    zaaid values, refresh token, client id/secret, hostnames)
  - your assessment of friction points (where the persona helped,
    where it got in the way, where the spec was ambiguous)
```

**What the agent should do:**

1. Run prompts 1 through 4 in sequence, capturing the output of each.
2. Draft a single Markdown document matching the verification-report template.
3. **Sanitize aggressively** before returning the report: replace customer names with `<customer-N>`, `zaaid` values with `<zaaid-N>`, monitor names with `<monitor-N>`, hostnames with `<host>`. Never echo the refresh token, client id, or client secret — those don't enter the sandbox anyway, but the persona must not paste them in even if asked.

If your agent + model combination produces this report cleanly, paste it into a [new verification report](https://github.com/jmpijll/site24x7-code-mode-mcp/issues/new?template=verification_report.yml). That single act is the highest-leverage thing any tester can do for this project right now.

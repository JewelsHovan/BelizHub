import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const headers = { "X-Beliz-Request": "local" };
async function sample(page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try the sample", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "What makes a PCR result trustworthy?" }),
  ).toBeVisible();
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function accessible(page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}

test.beforeEach(async ({ request }) => {
  const lectures = await (await request.get("/api/lectures")).json();
  for (const lecture of lectures)
    await request.delete(`/api/lectures/${lecture.id}`, { headers });
});

test("home, source-linked notes, editing, autosave, markers, reload and resume", async ({
  page,
}, testInfo) => {
  const errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4318")) external.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back, Beliz." }),
  ).toBeVisible();
  await accessible(page);
  await page.screenshot({
    path: testInfo.outputPath("desk-home-empty.png"),
    fullPage: true,
  });
  await sample(page);
  await page.getByRole("button", { name: "Select 0:42", exact: true }).click();
  await page.getByRole("button", { name: "Lost here", exact: false }).click();
  await expect(page.locator("#source-p3 .pill")).toHaveText("Lost here");
  await page.getByRole("button", { name: "+ Add note", exact: true }).click();
  await page
    .getByLabel("My note", { exact: true })
    .fill(
      "<img src=x onerror=alert(1)> A no-RT control tests for DNA contribution.",
    );
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.locator(".note-text").last()).toContainText("<img src=x");
  await expect(page.locator(".note-card img")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit note", exact: true })
    .last()
    .click();
  await page
    .getByLabel("My note", { exact: true })
    .fill("A no-RT control helps assess DNA contribution.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page
    .locator("#brief")
    .fill("Controls help separate observations from interpretations.");
  await expect(page.locator("#save-status")).toHaveText("Saved on this laptop");
  await accessible(page);
  await page.screenshot({
    path: testInfo.outputPath("lecture-desktop.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("#brief")).toHaveValue(
    "Controls help separate observations from interpretations.",
  );
  await expect(page.locator("#source-p3")).toHaveClass(/active/);
  await expect(page.locator(".note-text").last()).toHaveText(
    "A no-RT control helps assess DNA contribution.",
  );
  await page.getByRole("link", { name: "My desk", exact: false }).click();
  await expect(
    page.getByRole("link", { name: "Resume studying", exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("desk-home-resume.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("practice waits for an attempt, supports hints, self-ratings, a capped session, and unchecked questions", async ({
  page,
}) => {
  await sample(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#answer")).toBeHidden();
  await page.getByRole("button", { name: "A hint", exact: true }).click();
  await expect(page.locator("#hint")).toBeVisible();
  await page.locator("#attempt").fill("Contamination.");
  await page
    .getByRole("button", { name: "Check my explanation", exact: true })
    .click();
  await expect(page.locator("#answer")).toBeVisible();
  await page
    .getByRole("button", { name: "I can explain it", exact: true })
    .click();
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "Check my explanation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Revisit tomorrow", exact: true })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "A good place to pause." }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Write a source-backed question",
      exact: false,
    })
    .click();
  await page
    .getByLabel("Question", { exact: true })
    .fill("What is the lecture question?");
  await page
    .getByLabel("Expected answer", { exact: true })
    .fill("What makes a PCR result trustworthy?");
  await page
    .getByRole("button", { name: "Save question", exact: true })
    .click();
  await page
    .getByText("1 question(s) need a source check", { exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "I checked this against the source",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Start another small session", exact: true })
    .click();
  await expect(page.locator(".practice-question")).toHaveText(
    "What is the lecture question?",
  );
  await accessible(page);
});

test("import pasted text, preserve paragraph sources, export, filter and delete", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "+ Add lecture", exact: true })
    .click();
  await page
    .getByLabel("Lecture title", { exact: true })
    .fill("A real workflow test");
  await page.getByLabel("Course", { exact: true }).fill("Molecular biology");
  await page
    .getByLabel("Or paste a plain-text transcript", { exact: true })
    .fill(
      "Names, units, and qualifications.\n\nDo not silently replace scientific terms.",
    );
  await page.getByRole("checkbox").check();
  await accessible(page);
  await page.getByRole("button", { name: "Save lecture", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A real workflow test" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select Paragraph 2", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Export lecture ↓", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("beliz-lecture.zip");
  await page.getByRole("link", { name: "My lectures", exact: false }).click();
  await page.getByLabel("Find a lecture", { exact: true }).fill("no match");
  await expect(
    page.getByRole("heading", { name: "No matching lectures." }),
  ).toBeVisible();
  await page.getByLabel("Find a lecture", { exact: true }).fill("workflow");
  await page.getByRole("link", { name: /A real workflow test/ }).click();
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete lecture", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Give your next lecture a home." }),
  ).toBeVisible();
});

test("malformed import gives actionable errors without losing the form", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "+ Add lecture", exact: true })
    .click();
  await page.getByLabel("Lecture title", { exact: true }).fill("Bad cue");
  await page.getByLabel("Course", { exact: true }).fill("Biotech");
  await page.locator("#transcript-file").setInputFiles({
    name: "bad.srt",
    mimeType: "text/plain",
    buffer: Buffer.from("broken ending"),
  });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save lecture", exact: true }).click();
  await expect(page.locator("#modal-error")).toContainText(
    "Cannot read timing",
  );
  await expect(page.getByLabel("Lecture title", { exact: true })).toHaveValue(
    "Bad cue",
  );
  await page.locator("#transcript-file").setInputFiles({
    name: "fixed.srt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "1\n00:00:00,000 --> 00:00:05,000\nThe corrected source.",
    ),
  });
  await page.getByRole("button", { name: "Save lecture", exact: true }).click();
  await expect(page.locator("#source-p1")).toContainText(
    "The corrected source.",
  );
});

test("attachment copy, audio seek and restored playback position", async ({
  page,
  request,
}) => {
  // A real PCM WAV, generated for the test; no student recording is used.
  const data = Buffer.alloc(44 + 8000 * 2 * 140);
  data.write("RIFF");
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(data.length - 44, 40);
  await sample(page);
  await page
    .getByRole("button", { name: "Files & checks", exact: true })
    .click();
  await page
    .locator('[data-upload="audio"]')
    .setInputFiles({ name: "test.wav", mimeType: "audio/wav", buffer: data });
  await expect(page.locator("#audio")).toBeVisible();
  await expect
    .poll(() => page.locator("#audio").evaluate((a) => a.readyState))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Select 0:42", exact: true }).click();
  await expect
    .poll(() => page.locator("#audio").evaluate((a) => a.currentTime))
    .toBeCloseTo(42, 0);
  const id = page.url().split("/").at(-1);
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/lectures/" + id)).json()).position
          .seconds,
    )
    .toBeCloseTo(42, 0);
  await page.reload();
  await expect
    .poll(() => page.locator("#audio").evaluate((a) => a.currentTime))
    .toBeCloseTo(42, 0);
});

test("failed autosave retains the draft and can be retried", async ({
  page,
}) => {
  await sample(page);
  await page.route("**/api/lectures/*", async (route) => {
    if (route.request().method() === "PATCH")
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Disk full for this test." }),
      });
    return route.continue();
  });
  await page.locator("#brief").fill("Keep this draft, even when saving fails.");
  await expect(page.locator("#error")).toContainText("Disk full");
  await expect(page.locator("#brief")).toHaveValue(
    "Keep this draft, even when saving fails.",
  );
  await page.unroute("**/api/lectures/*");
  await page.getByRole("button", { name: "Save brief", exact: true }).click();
  await expect(page.locator("#save-status")).toHaveText("Saved on this laptop");
  await page.reload();
  await expect(page.locator("#brief")).toHaveValue(
    "Keep this draft, even when saving fails.",
  );
});

test("phone and tablet layouts remain usable and accessible", async ({
  page,
}, testInfo) => {
  await sample(page);
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(page);
    await accessible(page);
    await page.screenshot({
      path: testInfo.outputPath(`lecture-${width}.png`),
      fullPage: true,
    });
  }
});

test("public hub works under the Pages subpath and only links to the private workspace", async ({
  page,
}, testInfo) => {
  const failed = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("favicon")) failed.push(r.url());
  });
  await page.goto("http://127.0.0.1:4319/BelizHub/");
  await expect(
    page.getByRole("link", { name: "Open my Lecture Desk", exact: false }),
  ).toHaveAttribute("href", "http://127.0.0.1:4317/");
  await accessible(page);
  await page.screenshot({
    path: testInfo.outputPath("public-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await accessible(page);
  await page.screenshot({
    path: testInfo.outputPath("public-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Explore RT-PCR", exact: false })
    .click();
  await expect(page.locator("#root")).not.toBeEmpty();
  expect(failed.filter((url) => url.startsWith("http://127.0.0.1"))).toEqual(
    [],
  );
});

test("local RT-PCR lab loads with relative assets and permits its interactive styles", async ({
  page,
}) => {
  const localErrors = [];
  page.on("pageerror", (e) => localErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().includes("Content Security Policy"))
      localErrors.push(m.text());
  });
  await page.goto("/pcr-explained/");
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.getByRole("main")).toBeVisible();
  expect(localErrors).toEqual([]);
});

test("a delayed note response cannot roll back a newer saved brief", async ({
  page,
  request,
}) => {
  await sample(page);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/lectures/*/notes", async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "+ Add note", exact: true }).click();
  await page
    .getByLabel("My note", { exact: true })
    .fill("A note with a slow response.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page
    .locator("#brief")
    .fill("A newer brief must survive the old note response.");
  const id = page.url().split("/").at(-1);
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/lectures/" + id)).json()).brief,
    )
    .toBe("A newer brief must survive the old note response.");
  release();
  await expect(page.locator(".note-text").last()).toHaveText(
    "A note with a slow response.",
  );
  await expect(page.locator("#brief")).toHaveValue(
    "A newer brief must survive the old note response.",
  );
  await page.reload();
  await expect(page.locator("#brief")).toHaveValue(
    "A newer brief must survive the old note response.",
  );
});

test("low-energy mode limits practice to one question and is retained", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Just one thing", exact: true })
    .click();
  await sample(page);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(
    page.getByText("One question is enough for this session.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check my explanation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "I can explain it", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A good place to pause." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "My desk", exact: false }).click();
  await expect(
    page.getByRole("button", { name: "Just one thing", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

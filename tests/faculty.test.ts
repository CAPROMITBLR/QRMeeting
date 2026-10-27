import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ sql: mocks.sql }));

import { loadFacultyRoster } from "../lib/faculty";
import {
  departmentOptions,
  filterById,
  filterByName,
  formatMaheId,
  idDigits,
  maheIdDigits,
  normalizeFacultyId,
  type FacultyMember,
} from "../lib/faculty-directory";

const ROSTER: FacultyMember[] = [
  { maheId: "MAHE0023571", name: "Dr. Dayananda P", department: "School of Computer Science Engineering" },
  { maheId: "MAHE0028678", name: "Dr. Akshatha Y", department: "School of Computer Science Engineering" },
  { maheId: "MAHE0028678", name: "Dr. S Priya", department: "School of Computer Science Engineering" },
  { maheId: "MAHE0017820", name: "Dr. Iven Jose", department: "Director MIT - BLR" },
  { maheId: null, name: "Dr. Nithish Kumar R", department: "School of Basic Sciences Humanities & Management" },
];

describe("MAHE ID formatting", () => {
  it("keeps digits only, whatever was typed or pasted", () => {
    expect(idDigits(" MAHE 0023571 ")).toBe("0023571");
    expect(idDigits("mahe-23571")).toBe("23571");
    expect(idDigits("")).toBe("");
  });

  it("adds the prefix people never type", () => {
    expect(formatMaheId("23571")).toBe("MAHE23571");
    expect(formatMaheId("MAHE 0023571")).toBe("MAHE0023571");
    expect(formatMaheId("")).toBe("");
  });

  it("normalizes on the server side too, without mangling a different ID", () => {
    expect(normalizeFacultyId("23571")).toBe("MAHE23571");
    expect(normalizeFacultyId("mahe 0023571")).toBe("MAHE0023571");
    expect(normalizeFacultyId("")).toBe("");
    expect(normalizeFacultyId(null)).toBe("");
    expect(normalizeFacultyId("MIT/2019/07")).toBe("MIT201907");
  });

  it("round-trips a stored ID back into the input field", () => {
    expect(maheIdDigits("MAHE0023571")).toBe("0023571");
    expect(maheIdDigits(null)).toBe("");
  });
});

describe("filterByName", () => {
  it("lists everyone in ascending order when nothing is typed", () => {
    expect(filterByName(ROSTER, "").map((m) => m.name)).toEqual([
      "Dr. Akshatha Y",
      "Dr. Dayananda P",
      "Dr. Iven Jose",
      "Dr. Nithish Kumar R",
      "Dr. S Priya",
    ]);
  });

  it("matches a substring, ignoring case and padding", () => {
    expect(filterByName(ROSTER, "  iven ").map((m) => m.name)).toEqual(["Dr. Iven Jose"]);
    expect(filterByName(ROSTER, "dr. s").map((m) => m.name)).toEqual(["Dr. S Priya"]);
    expect(filterByName(ROSTER, "nobody")).toEqual([]);
  });

  it("ignores ID digits: the ID field is the one that answers those", () => {
    expect(filterByName(ROSTER, "23571")).toEqual([]);
  });
});

describe("filterById", () => {
  it("lists every known ID in ascending order when nothing is typed", () => {
    expect(filterById(ROSTER, "").map((m) => m.maheId)).toEqual([
      "MAHE0017820",
      "MAHE0023571",
      "MAHE0028678",
      "MAHE0028678",
    ]);
  });

  it("matches a fragment anywhere in the ID", () => {
    expect(filterById(ROSTER, "178").map((m) => m.name)).toEqual(["Dr. Iven Jose"]);
    expect(filterById(ROSTER, "23571").map((m) => m.name)).toEqual(["Dr. Dayananda P"]);
    expect(filterById(ROSTER, "MAHE0028").map((m) => m.name)).toEqual(["Dr. Akshatha Y", "Dr. S Priya"]);
    expect(filterById(ROSTER, "999")).toEqual([]);
  });

  it("leaves out the person whose ID has not been issued", () => {
    expect(filterById(ROSTER, "").some((m) => m.maheId === null)).toBe(false);
  });
});

describe("departmentOptions", () => {
  it("de-duplicates and sorts the departments", () => {
    expect(departmentOptions(ROSTER)).toEqual([
      "Director MIT - BLR",
      "School of Basic Sciences Humanities & Management",
      "School of Computer Science Engineering",
    ]);
  });
});

describe("loadFacultyRoster", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
  });

  it("keeps a row that has no MAHE ID yet", async () => {
    mocks.sql.mockReset();
    mocks.sql.mockResolvedValue([
      { mahe_id: "MAHE0023571", name: "Dr. Dayananda P", department: "SOCE" },
      { mahe_id: null, name: "Dr. Nithish Kumar R", department: "SBHM" },
    ]);
    expect(await loadFacultyRoster()).toEqual([
      { maheId: "MAHE0023571", name: "Dr. Dayananda P", department: "SOCE" },
      { maheId: null, name: "Dr. Nithish Kumar R", department: "SBHM" },
    ]);
  });

  it("maps every row, so the attend form can filter the whole list", async () => {
    mocks.sql.mockResolvedValue([{ mahe_id: "MAHE0023571", name: "Dr. Dayananda P", department: "SOCE" }]);
    expect(await loadFacultyRoster()).toHaveLength(1);
  });
});

import type { TimelineEvent } from "@/models/TimelineEvent";
import {
  patientHistoryDescriptionLabel,
  patientHistoryTimeLabel,
  patientHistoryTitleLabel,
} from "../TimelinePresentation";

const event = (overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: "TL-CHEST-DRAIN-CMD-1",
  exerciseId: "EX-1",
  patientId: "PT-1",
  timestamp: "T+206s",
  simulationTimeSec: 206,
  sequenceNumber: 1,
  type: "intervention",
  title: "Chest drain inserted",
  description: "Canonical pleural drainage intervention applied",
  author: "EXCON",
  visibility: "revealed",
  ...overrides,
});

describe("WP-45B patient History presentation", () => {
  test("formats canonical simulation time deterministically without Invalid Date", () => {
    expect(patientHistoryTimeLabel(event())).toBe("T+03:26");
    expect(patientHistoryTimeLabel(event())).not.toContain("Invalid Date");
  });

  test("keeps valid ISO timestamps supported for legacy History rows", () => {
    expect(patientHistoryTimeLabel(event({ simulationTimeSec: undefined, timestamp: "2026-08-24T08:03:04.000Z" })))
      .not.toContain("Invalid Date");
  });

  test("uses Estonian lifecycle-appropriate chest-drain wording", () => {
    expect(patientHistoryTitleLabel(event({ title: "Chest drain insertion started" }))).toBe("Pleuradreeni paigaldamine");
    expect(patientHistoryTitleLabel(event())).toBe("Pleuradreen paigaldati");
    expect(patientHistoryDescriptionLabel(event().description)).toBe("Kanooniline pleuradreeni sekkumine rakendati");
  });

  test("presentation preserves canonical identity and cannot create duplicate rows", () => {
    const source = [event()];
    const rendered = source.map(item => ({ id: item.id, title: patientHistoryTitleLabel(item), time: patientHistoryTimeLabel(item) }));
    expect(rendered).toHaveLength(1);
    expect(rendered[0].id).toBe("TL-CHEST-DRAIN-CMD-1");
    expect(source[0]).toMatchObject({ type: "intervention", simulationTimeSec: 206, title: "Chest drain inserted" });
  });

  test("localizes transport evidence without replacing its canonical identity", () => {
    const source = event({ id: "TL-TRANSPORT-1-1", type: "transfer", title: "TRANSPORT_DEPARTED" });
    expect(patientHistoryTitleLabel(source)).toBe("Transport alustas sõitu");
    expect(source).toMatchObject({ id: "TL-TRANSPORT-1-1", type: "transfer", title: "TRANSPORT_DEPARTED" });
  });
});

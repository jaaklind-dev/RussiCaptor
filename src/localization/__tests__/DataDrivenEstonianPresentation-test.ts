import {
  analyticsCategoryLabel, analyticsMetricNameLabel, analyticsUnitLabel, evidenceSourceLabel,
  metricScopeLabel, timelineActorLabel, timelineCategoryLabel, timelineEventDescriptionLabel, timelineEventTitleLabel,
  timelineGroupLabel, timelineSeverityLabel,
} from "@/localization/dataDrivenEt";

describe("WP-46A data-driven Estonian presentation", () => {
  test("maps Timeline categories, severities and groups", () => {
    expect(timelineCategoryLabel("PATIENT")).toBe("patsient");
    expect(timelineSeverityLabel("WARNING")).toBe("hoiatus");
    expect(timelineGroupLabel("SIMULATION_MINUTE")).toBe("simulatsiooniminut");
  });

  test("maps event titles without mutating canonical input", () => {
    const event = Object.freeze({ type: "PELVIC_BINDER_APPLICATION", title: "Pelvic binder applied" });
    expect(timelineEventTitleLabel(event)).toBe("Vaagnalahase paigaldamine");
    expect(event).toEqual({ type: "PELVIC_BINDER_APPLICATION", title: "Pelvic binder applied" });
  });

  test("maps authored canonical Timeline titles and actors", () => {
    expect(timelineEventTitleLabel({ type: "runtime_tick", title: "Clinical runtime advanced" })).toBe("Kliiniline simulatsioon liikus edasi");
    expect(timelineActorLabel("Exercise Controller")).toBe("õppuse juhtimiskeskus");
    expect(timelineActorLabel("EXCON")).toBe("Mängujuht");
    expect(timelineActorLabel("Jaak")).toBe("Jaak");
  });

  test("localizes canonical description templates while preserving authored text", () => {
    expect(timelineEventDescriptionLabel("Canonical patient runtime advanced by 60 seconds")).toBe("Patsiendi kanooniline simulatsioon liikus 60 sekundit edasi");
    expect(timelineEventDescriptionLabel("Kliiniline vabatekst")).toBe("Kliiniline vabatekst");
  });

  test("maps Analytics categories, names, units and scope", () => {
    expect(analyticsCategoryLabel("EXERCISE_FLOW")).toBe("õppuse kulg");
    expect(analyticsMetricNameLabel("exercise.duration.seconds", "Exercise duration")).toBe("Õppuse kestus");
    expect(analyticsMetricNameLabel("assessment.completion.ratio", "Assessment completion ratio")).toBe("Hindamise täielikkuse osakaal");
    expect(analyticsMetricNameLabel("assessment.satisfaction.ratio", "Expectation satisfaction ratio")).toBe("Ootuste täitmise osakaal");
    expect(analyticsMetricNameLabel("diagnostics.imaging.count", "Imaging request count")).toBe("Piltdiagnostika tellimuste arv");
    expect(analyticsMetricNameLabel("diagnostics.laboratory.count", "Laboratory request count")).toBe("Laboriuuringute tellimuste arv");
    expect(analyticsMetricNameLabel("exercise.paused.seconds", "Total paused duration")).toBe("Pauside kogukestus");
    expect(analyticsUnitLabel("SECONDS")).toBe("s");
    expect(analyticsUnitLabel("BOOLEAN")).toBe("tõeväärtus");
    expect(analyticsUnitLabel("NONE")).toBe("ühikuta");
    expect(analyticsUnitLabel("TEXT")).toBe("tekst");
    expect(metricScopeLabel("EXERCISE")).toBe("õppus");
  });

  test("maps evidence source labels", () => {
    expect(evidenceSourceLabel("TIMELINE_EVENT")).toBe("ajajoone sündmus");
    expect(evidenceSourceLabel("ASSESSMENT_RESULT")).toBe("hindamistulemus");
  });

  test("unknown canonical values remain explicit and detectable", () => {
    expect(timelineCategoryLabel("FUTURE" as never)).toBe("Tundmatu ajajoone kategooria: FUTURE");
    expect(analyticsCategoryLabel("FUTURE" as never)).toBe("Tundmatu analüütikakategooria: FUTURE");
    expect(analyticsMetricNameLabel("future.metric", "Future Metric")).toBe("Mõõdik: future.metric");
  });
});

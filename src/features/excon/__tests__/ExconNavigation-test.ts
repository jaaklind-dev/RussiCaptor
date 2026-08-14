import { openExerciseCatalog, openExerciseDashboard } from "../ExconNavigation";

describe("EXCON navigation", () => {
  test("the dashboard control targets the supported Exercise Dashboard route", () => {
    const navigate = jest.fn();
    openExerciseDashboard(navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/excon/dashboard");
  });

  test("the sibling catalog control keeps its own route", () => {
    const navigate = jest.fn();
    openExerciseCatalog(navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/excon/catalog");
  });

});

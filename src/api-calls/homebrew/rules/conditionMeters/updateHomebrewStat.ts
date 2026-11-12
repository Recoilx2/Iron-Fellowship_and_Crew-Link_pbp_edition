import { createApiFunction } from "api-calls/createApiFunction";
import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { getHomebrewConditionMeterDoc } from "./_getRef";
import { HomebrewConditionMeterDocument } from "api-calls/homebrew/rules/conditionMeters/_homebrewConditionMeters.type";

export const updateHomebrewConditionMeter = createApiFunction<
  {
    conditionMeterId: string;
    conditionMeter: DocumentUpdate<HomebrewConditionMeterDocument>;
  },
  void
>((params) => {
  const { conditionMeterId, conditionMeter } = params;
  return new Promise((resolve, reject) => {
    updateDoc(
      getHomebrewConditionMeterDoc(conditionMeterId),
      conditionMeter as UpdateData<HomebrewConditionMeterDocument>
    )
      .then(() => {
        resolve();
      })
      .catch(reject);
  });
}, "Failed to update condition meter.");

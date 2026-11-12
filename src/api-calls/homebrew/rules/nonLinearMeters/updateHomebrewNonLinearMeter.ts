import { createApiFunction } from "api-calls/createApiFunction";
import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { getHomebrewNonLinearMeterDoc } from "./_getRef";
import { HomebrewNonLinearMeterDocument } from "api-calls/homebrew/rules/nonLinearMeters/_homebrewNonLinearMeter.type";

export const updateHomebrewNonLinearMeter = createApiFunction<
  {
    meterId: string;
    meter: DocumentUpdate<HomebrewNonLinearMeterDocument>;
  },
  void
>((params) => {
  const { meterId, meter } = params;
  return new Promise((resolve, reject) => {
    updateDoc(
      getHomebrewNonLinearMeterDoc(meterId),
      meter as UpdateData<HomebrewNonLinearMeterDocument>
    )
      .then(() => {
        resolve();
      })
      .catch(reject);
  });
}, "Failed to update meter.");

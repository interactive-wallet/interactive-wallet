import {
  applicationDefault,
  cert,
  initializeApp,
  refreshToken,
} from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

// iosl26-mediator@iosl26.iam.gserviceaccount.com
// permission: firebase cloud messaging admin
// https://console.cloud.google.com/iam-admin/serviceaccounts/details/113342191219388204921/metrics?authuser=0&hl=en-US&project=iosl26

const app = initializeApp({
  projectId: "iosl26",
  credential: cert("iosl26-581bdbfd9908.json"),
  // credential: refreshToken(myRefreshToken),
  // credential: applicationDefault(), // uses export GOOGLE_APPLICATION_CREDENTIALS="/home/user/Downloads/service-account-file.json"
});

const token = "TODO";
// const topic = "TODO";

const fcm = getMessaging(app);

// testing could use this
// const sub = await fcm.subscribeToTopic(token, topic);

const sentId = await fcm.send({
  token,
  // topic,
  // condition,
  data: {},
  // notification: { title, body },
  // android: { bandwidthConstrainedOk: true, data: { k: "strings only" } },
});

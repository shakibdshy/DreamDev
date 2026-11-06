// @ts-check
import { module } from "@prisma/composer";
import webService from "./apps/web/service.mjs";

export default module("dream-development", ({ provision }) => {
  provision(webService);
});

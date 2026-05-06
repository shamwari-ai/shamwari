/// <reference types="@sveltejs/kit" />

declare global {
  namespace App {
    interface Locals {
      auth: import("@workos/authkit-sveltekit").AuthKitAuth;
    }
  }
}

export {};

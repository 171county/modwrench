// node:os in the browser build. A web page can't know the visitor's account or computer name, so these answer with
// nothing. The page also asks the redactor not to learn this machine's names (ownNames: false), so it relies on its
// patterns alone: folder paths, labelled lines such as "USERNAME=", addresses, keys and IDs.
export const homedir = (): string => "";
export const hostname = (): string => "";
export const userInfo = (): { username: string; uid: number; gid: number; shell: null; homedir: string } => ({
  username: "",
  uid: -1,
  gid: -1,
  shell: null,
  homedir: "",
});

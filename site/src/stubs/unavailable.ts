// The website runs ModWrench's crash reading and Crew Check on text pasted into the page. The code they share with the
// installed tools also imports Node's file, path and system modules, for reading logs and installs from disk. In the
// browser build those imports point at these stubs. A stub that would touch the disk or name a file throws: the page
// never calls one, and site/test proves it by running the bundle where every such call fails.

export function unavailable(name: string): () => never {
  return () => {
    throw new Error(`${name} is not available on the website: it reads only the text pasted into the page.`);
  };
}

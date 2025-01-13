import { useContext } from "react";
import DcfContext from "./context";

function useDcf() {
  const context = useContext(DcfContext);
  if (context === null) {
    throw new Error("DcfContext not found");
  }
  return context;
}

export default useDcf;

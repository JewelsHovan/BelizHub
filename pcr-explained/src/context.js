import { createContext } from 'react';

// Cross-tab state: the Primers tab publishes its computed Tm pair so the Protocol tab can pull it.
export const PrimerContext = createContext({ primerTm: null, setPrimerTm: () => {} });

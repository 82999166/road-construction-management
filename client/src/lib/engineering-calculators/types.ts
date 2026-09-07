export type CalculatorInputSpec = {
  key: string;
  label: string;
  unit: string;
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
};

export type CalculatorOutputSpec = {
  key: string;
  label: string;
  unit: string;
  precision: number;
};

export type EngineeringCalculatorSpec = {
  id: string;
  title: string;
  formula: string;
  inputs: CalculatorInputSpec[];
  outputs: CalculatorOutputSpec[];
  exampleSummary: string;
  riskNotice: string;
  requiresProfessionalReview: boolean;
  calculate: (values: Record<string, number>) => Record<string, number>;
};

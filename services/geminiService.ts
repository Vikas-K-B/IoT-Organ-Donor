import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateTaskDescription = async (): Promise<{ title: string; description: string }> => {
  // Fallback if no API key is set
  if (!process.env.API_KEY) {
      return {
          title: "System Diagnostic",
          description: "print('Running system diagnostics...')\nimport time\ntime.sleep(1)\nprint('All systems nominal.')"
      };
  }

  try {
    const model = 'gemini-2.5-flash';
    const prompt = `Generate a short python script title and the script itself for a distributed computing task. 
    Examples: Calculating Pi, Matrix Mult, fibonacci.
    Return ONLY a JSON object with keys "title" and "description" (where description is the code). Do not use markdown blocks.`;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    return JSON.parse(text);
  } catch (error) {
    console.error("Error generating task:", error);
    return {
      title: "Prime Calculation",
      description: "def is_prime(n):\n    if n < 2: return False\n    for i in range(2, int(n**0.5) + 1):\n        if n % i == 0: return False\n    return True\nprint([x for x in range(100) if is_prime(x)])"
    };
  }
};

export const executePythonSimulation = async (code: string): Promise<string> => {
    if (!process.env.API_KEY) return "Output: [Simulation] API Key missing. Execution successful.";

    try {
        const model = 'gemini-2.5-flash';
        const prompt = `Act as a Python Interpreter. Execute the following code and return ONLY the output text. Do not explain the code.
        
        CODE:
        ${code}
        `;

        const response = await ai.models.generateContent({
            model,
            contents: prompt,
        });

        return response.text || "Execution completed. No output.";
    } catch (error) {
        return "RuntimeError: Execution timeout or API failure.";
    }
}
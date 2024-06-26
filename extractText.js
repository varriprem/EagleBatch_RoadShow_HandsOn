const axios = require("axios"); // Import axios for HTTP requests
const puppeteer = require("puppeteer"); // Import Puppeteer for web scraping
const https = require("https"); // Import https for secure requests
const cheerio = require("cheerio"); // Import cheerio for parsing HTML

// Define the prompt template for extracting company information from website content
const websiteUserprompt = `Add your prompt here`;

const ingestSupplier = async (companyName, companyURL) => {
  try {
    // Check if both companyURL and companyName are not provided
    if (!companyURL && !companyName) {
      return { error: "Please provide a URL or Name in the request body." };
    }

    // Initialize a variable to store the final extracted text
    var finalExtractedText = "";

    // Launch a Puppeteer browser instance
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    // Navigate to the company URL with specific options
    await page.goto(companyURL, {
      headless: false, // Open browser in non-headless mode
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Sandbox arguments for security
    });

    // Extract text content from the page
    const textContent = await page.evaluate(() => {
      let texts = [];
      // Iterate over all elements in the body and collect their inner text
      document.querySelectorAll("body *").forEach((element) => {
        const text = element?.innerText?.trim();
        if (text) {
          texts.push(text);
        }
      });
      return texts;
    });

    // Extract unique links from the page
    const uniqueLinks = await page.evaluate(() => {
      let linkElements = document.querySelectorAll("a");
      let links = [];
      // Collect all href attributes from link elements
      linkElements.forEach((link) => {
        links.push(link.href);
      });
      // Return a unique set of links, limited to the first 10
      return [...new Set(links)].slice(0, 10);
    });

    // Close the Puppeteer browser instance
    await browser.close();

    // Filter out social media links from the extracted unique links
    let filterUniqueLinks = uniqueLinks.filter(link => !link.includes("facebook") && !link.includes("twitter") && !link.includes("instagram") && !link.includes("youtube"));

    // Extract text content from the filtered unique links
    const websiteTextPromises = filterUniqueLinks.map(async (link) => {
      const extractedText = await readSearchLinks(link);
      finalExtractedText += " " + extractedText;
    });

    // Wait for all text extraction promises to complete
    await Promise.allSettled(websiteTextPromises);

    // Limit the final extracted text to 10,000 characters
    finalExtractedText = finalExtractedText.substring(0, 10000);

    // Replace placeholder in the system prompt with the final extracted text
    let systemPrompt = websiteUserprompt.replace("[( )]", finalExtractedText);

    // Generate a summary using the system prompt and user prompt
    let summary = await generateSummary(systemPrompt, websiteUserprompt);


    // Parse the summary data if it's an object
    let summaryDetails =  typeof(summary.data) == 'string' ? JSON.parse(summary.data) : summary.data;
    
    // Add the company name to the summary details
    summaryDetails.Company_Name = companyName;
    
    // Return the summary details
    return {
      summary: summaryDetails,
    };
  } catch (error) {
    // Log and return the error if any occurs
    console.log(error);
    return { error: error.message };
  }
};

const readSearchLinks = async (link) => {
  // Return a new Promise to handle asynchronous operation
  return new Promise(async (resolve, reject) => {
    try {
      let $; // Variable to hold the cheerio instance
      let htmlData; // Variable to hold the HTML data

      // Fetch the HTML data from the provided link
      htmlData = await axios.get(link, {
        httpsAgent: new https.Agent({
          rejectUnauthorized: false, // Allow requests to servers with self-signed certificates
        }),
      });

      // Load the fetched HTML data into cheerio for parsing
      $ = cheerio.load(htmlData.data);

      // Extract the title text from the HTML
      const titleText = $("title").text();

      // Remove script and style tags to clean up the HTML
      $("script, style").remove();

      // Extract and clean up the body text
      const textContent = $("body")
        .clone() // Clone the body element
        .find("script")
        .remove() // Remove any script tags within the body
        .end()
        .text(); // Get the text content of the cleaned-up body

      // Concatenate and clean up the extracted text
      let concatenatedText = textContent.replace(/\s+/g, " ").trim();
      concatenatedText = titleText + " " + concatenatedText;

      // Resolve the promise with the concatenated text
      resolve(concatenatedText);
    } catch (error) {
      // Reject the promise if there's an error
      reject(error);
    }
  });
};



const generateSummary = async (systemPrompt, inputPrompt) => {
  // Return a new Promise to handle asynchronous operation
  return new Promise(async (resolve, reject) => {
    try {
      // Prepare the data to be sent in the request
      let data = JSON.stringify({
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: inputPrompt,
          },
        ],
      });

      // Configure the request with method, URL, headers, and data
      let config = {
        method: "post", // HTTP method
        maxBodyLength: Infinity, // Allow unlimited body length
        url: process.env.END_POINT, // API endpoint
        headers: {
          "access-key": process.env.ACCESS_KEY, // Access key for authentication
          model: process.env.MODEL, // Model to be used
          "Content-Type": "application/json", // Content type of the request
        },
        data: data, // Data to be sent in the request
      };

      // Make the request using axios with the provided configuration
      const response = await axios.request(config);

      // Resolve the promise with the response data
      resolve({ status: true, data: response?.data?.message?.content });
    } catch (error) {
      // Reject the promise if there's an error
      reject(error);
    }
  });
};



module.exports = {
  ingestSupplier,
};

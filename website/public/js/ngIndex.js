var p = angular.module("ngIndex", ["ngSanitize"]);

p.controller('IndexCtrl', function ($scope) {
    $scope.gettingStarted = [
      {
        "title": "create or edit a LiPD file",
        "descriptions": [
          "Use the <a href='/playground'>LiPD Playground</a>: enter data and download your dataset as a LiPD file",
          "Use <a href='https://github.com/nickmckay/lipdR'>lipdR</a> (R): read, edit, and write LiPD files directly in R",
          "Use <a href='https://github.com/LinkedEarth/pylipd'>pylipd</a> (Python): read, edit, and write LiPD files in Python"
        ]
      },
      {
        "title": "analyze LiPD data",
        "descriptions": [
          "Use <a href='https://github.com/nickmckay/lipdR'>lipdR</a> with <a href='https://nickmckay.github.io/GeoChronR/'>GeoChronR</a> for age modeling, time series analysis, and visualization in R",
          "Use <a href='https://github.com/LinkedEarth/pylipd'>pylipd</a> with <a href='https://github.com/LinkedEarth/Pyleoclim_util'>Pyleoclim</a> for spectral analysis, mapping, and visualization in Python"
        ]
      },
      {
        "title": "find LiPD datasets",
        "descriptions": [
          "Browse and download datasets from <a href='https://lipdverse.org/'>LiPDverse</a>, the community archive for LiPD files"
        ]
      },
      {
        "title": "understand the LiPD format",
        "descriptions": [
          "Read the <a href='/format'>Format Reference</a> for a technical description of the LiPD file structure, field definitions, and CSV conventions"
        ]
      }
    ];

    $scope.quickLinks = [
      {
        "icon": "toys",
        "title": "LiPD Playground",
        "link": "./playground",
        "tooltip": "Create and edit LiPD files in your browser"
      },
      {
        "icon": "description",
        "title": "Format Reference",
        "link": "./format",
        "tooltip": "Technical specification of the LiPD file format for developers"
      },
      {
        "icon": "code",
        "title": "lipdR",
        "link": "https://github.com/nickmckay/lipdR",
        "tooltip": "R package for reading, writing, and analyzing LiPD files"
      },
      {
        "icon": "code",
        "title": "pylipd",
        "link": "https://github.com/LinkedEarth/pylipd",
        "tooltip": "Python package for reading, writing, and analyzing LiPD files"
      },
      {
        "icon": "code",
        "title": "GeoChronR",
        "link": "https://nickmckay.github.io/GeoChronR/",
        "tooltip": "R package for age modeling and time series analysis with LiPD data"
      },
      {
        "icon": "code",
        "title": "Pyleoclim",
        "link": "https://github.com/LinkedEarth/Pyleoclim_util",
        "tooltip": "Python package for paleoclimate time series analysis and visualization"
      },
      {
        "icon": "public",
        "title": "LiPDverse",
        "link": "https://lipdverse.org/",
        "tooltip": "Community archive of LiPD datasets with browsing and download"
      },
      {
        "icon": "group",
        "title": "LinkedEarth",
        "link": "https://linked.earth/",
        "tooltip": "The LinkedEarth project — community paleoclimate data science"
      }
    ];

    $scope.faqs = [
      {
        "question": "What is a LiPD file?",
        "answer": "A LiPD (.lpd) file is a ZIP archive that bundles tabular proxy data (CSV files) with rich structured metadata (a JSON-LD file). It follows the BagIt specification for data integrity. See the Format Reference for full technical details."
      },
      {
        "question": "What tools are available for working with LiPD data?",
        "answer": "lipdR (R package) and pylipd (Python package) provide core read/write/validate functionality. GeoChronR (R) and Pyleoclim (Python) add advanced analysis and visualization. The LiPD Playground lets you create and edit files in your browser."
      },
      {
        "question": "Where can I find LiPD datasets?",
        "answer": "LiPD files are hosted on LiPDverse (lipdverse.org), a community archive with browsing, filtering, and bulk download."
      },
      {
        "question": "What is the difference between the Playground and the R/Python libraries?",
        "answer": "The LiPD Playground is great for creating or editing individual files in a browser with no installation required. The R and Python libraries are better for batch workflows, programmatic editing, and integration into analysis pipelines."
      },
      {
        "question": "How do I validate a LiPD file?",
        "answer": "Use validLipd() in lipdR, or POST metadata.jsonld to the /api/validator endpoint. The validator checks required fields, coordinate ranges, publication structure, TSid uniqueness, and column consistency."
      },
      {
        "question": "It's not working OR it could work better!",
        "answer": "Please let us know! File an issue on the relevant GitHub repository (lipdR, pylipd, or this site). Links are in Quick Links above."
      }
    ];

  });

<h1 align="left">
  <br>
  <a href="http://www.lipd.net"><img src="https://www.dropbox.com/s/kgeyec2b8cft5mo/lipd4.png?raw=1" alt="LiPD" width="225"></a>
</h1>

<p align="left">
      <a href="https://zenodo.org/badge/latestdoi/25707644"><img src="https://zenodo.org/badge/25707644.svg" alt="DOI"></a>
      <a href="https://img.shields.io/badge/license-GPL-brightgreen.svg"><img src="https://img.shields.io/badge/license-GPL-brightgreen.svg"></a>
</p>

Input/output and manipulation utilities for LiPD files on LiPD.net

-----

### What is it?

LiPD is short for Linked PaleoData. LiPD files are the data standard for storing and exchanging data amongst paleoclimate scientists. The package will help you convert your existing paleoclimate observations into LiPD files that can be shared and analyzed.

Organizing and using your observation data can be time  consuming. Our goal is to let you focus on more important tasks than data wrangling.

-----


## How to Cite this code

<a href="https://zenodo.org/badge/latestdoi/25707644"><img src="https://zenodo.org/badge/25707644.svg" alt="DOI"></a>

Use this link to visit the Zenodo website. It provides citation information in many popular formats.

------

## Further information

[Github - LiPD Utilities](https://github.com/nickmckay/LiPD-Utilities)

[Github - GeoChronR](https://github.com/nickmckay/GeoChronR)

[Linked Earth Wiki](http://wiki.linked.earth/Main_Page)

[LiPD.net](http://www.lipd.net)

------

## Contact

If you are having issues, please report them here on github in the issue tracker.


------


## License

The project is licensed under the [GNU Public License](https://github.com/nickmckay/LiPD-utilities/blob/master/Python/LICENSE).

## dev notes:
The Dockerfile for the production container is located at /root/Dockerfile
* note that the web address is hard-coded in 2 places in the file "website/public/js/ngContValidate.js"
The DigitalOcean (http://64.23.255.172:3001/) and lipd.net version are different only in these two lines.
The two containers in use are docker.io/davidedge/lipd_webapps:lipdnet44 (lipd.net) and docker.io/davidedge/lipd_webapps:lipdnet43 (DigitalOcean)

The website is launched from a container at port 3000 in both cases

* The local version of the website does not run correctly (maybe a problem with the node module set)

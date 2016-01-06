from geoChronR.Parser.misc.zips import *
from geoChronR.Parser.noaa.lpd_noaa import *
import json

__author__ = 'Chris Heiser'

"""
PURPOSE: Convert a .lpd file (specifically the jsonld JSON data) into a NOAA formatted txt file.

CHANGELOG
Version 1.0 / 12.09.2015 / Chris

Input: .lpd file (Zip containing a Bag)
Output: NOAA formatted .txt file

"""


def main():
    # Enter user-chosen directory path (i.e. '/Users/johnscott/lpd_library/')
    dir_root = 'ENTER_FILE_PATH_HERE'
    os.chdir(dir_root)

    # Run lpd_noaa or noaa_lpd ?
    # ans = input("Which conversion?\n1.LPD to NOAA\n2. NOAA to LPD")

    # .lpd to noaa
    # if ans == 1:

    # Find all needed files in current directory
    f_list = list_files('.lpd')

    # Create the output folder
    if not os.path.exists(os.path.join(dir_root, 'noaa')):
        os.makedirs(os.path.join(dir_root, 'noaa'))

    # Process each available file
    for name_ext in f_list:
        print('processing: {}'.format(name_ext))

        # File name w/o extension
        name = os.path.splitext(name_ext)[0]

        # Unzip file and get tmp directory path
        dir_tmp = unzip(name_ext)

        # Process file
        if dir_tmp:
            process_lpd(name, dir_tmp)

    # noaa to .lpd
    # elif ans == 2:
    #     f_list = list_files('.txt')

    return


def process_noaa():
    """
    Opens a NOAA text file, invokes doi_resolver, closes file, updates changelog, cleans directory, and makes new bag.
    :return: none
    """
    pass


def process_lpd(name, dir_tmp):
    """
    Opens up a jsonld file, invokes doi_resolver, closes file, updates changelog, cleans directory, and makes new bag.
    :param name: (str) Name of current .lpd file
    :param dir_tmp: (str) Path to tmp directory
    :return: none
    """

    dir_root = os.getcwd()
    dir_bag = os.path.join(dir_tmp, name)
    dir_data = os.path.join(dir_bag, 'data')

    # Navigate down to jld file
    # Directory Change: dir_root -> dir_data
    os.chdir(dir_data)

    # Open file and execute conversion script
    with open(os.path.join(dir_data, name + '.jsonld'), 'r+') as jld_file:
        jld_data = json.load(jld_file)
        NOAA(dir_root, name, jld_data).start()

    # except ValueError:
    #     txt_log(dir_root, 'quarantine.txt', name, "Invalid Unicode characters. Unable to load file.")

    # Move back to root for next loop
    # Directory Change: dir_data -> dir_root
    os.chdir(dir_root)

    # Delete tmp folder and all contents
    shutil.rmtree(dir_tmp)

    return

if __name__ == '__main__':
    main()

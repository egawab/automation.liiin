import zipfile
import os

def zipdir(path, ziph):
    for root, dirs, files in os.walk(path):
        for file in files:
            ziph.write(os.path.join(root, file), 
                       os.path.relpath(os.path.join(root, file), path))

if __name__ == '__main__':
    zipf = zipfile.ZipFile('public/LinkedInExtension.zip', 'w', zipfile.ZIP_DEFLATED)
    zipdir('extension/', zipf)
    zipf.close()
    print("Zipped successfully")
